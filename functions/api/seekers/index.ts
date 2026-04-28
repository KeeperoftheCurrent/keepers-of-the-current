// POST /api/seekers
// Public seeker intake.
//
// Body shape (clock-time bookings model):
//   {
//     name, email, house?,
//     event_id,
//     bookings: [ { trial_code, start_at } ],   // optional — empty means
//                                                // "register for the event,
//                                                // book trials later"
//     rings_pursued: ['body','mind','soul'],   // legacy preference (kept for now)
//     preferred_date?, preferred_time?         // legacy preference (kept for now)
//   }
//
// Server-side checks for each requested booking:
//   1. trial_code is bookable
//   2. trial fits inside one of Talia's windows for that event
//   3. trial does not overlap any existing active booking (incl. its buffer)
// All bookings + the registration commit atomically. If any conflict, 422.
//
// Email path is unchanged: 201 returned immediately; ctx.waitUntil sends the
// two transactional emails and writes back email_status.

import type { Env } from '../../lib/db';
import { queryFirst, queryAll, exec } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import { validateIntake, normalizeEmail } from '../../lib/validate';
import { sendBothEmails } from '../../lib/email';

interface EventRow {
  id: string;
  name: string;
  kind: 'expedition' | 'grand_gathering';
  starts_on: string | null;
  ends_on: string | null;
}

interface SeekerRow {
  id: string;
  name: string;
  email: string;
}

interface CatalogRow {
  code: string;
  bookable: number;
  duration_minutes: number | null;
  buffer_minutes: number;
}

interface WindowRow {
  day_date: string;
  start_time: string;
  end_time: string;
}

interface BookingRow {
  id: string;
  start_at: string;
  buffer_until: string;
}

interface BookingInput {
  trial_code: string;
  start_at: string;
}

// trial_intentions: notification-only trial codes the seeker flagged (no slot).
// Not stored in DB; included in the admin email so the Keeper knows to expect them.
function parseTrialIntentions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v) => typeof v === 'string' && v.trim().length > 0)
    .map((v) => (v as string).trim())
    .slice(0, 20); // reasonable cap
}

const ISODATETIME = /^\d{4}-\d{2}-\d{2}T([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

function addMinutes(iso: string, minutes: number): string {
  const d = new Date(`${iso}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function parseBookings(raw: unknown): BookingInput[] | { error: string } {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return { error: 'bookings must be an array' };
  const out: BookingInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i] as Record<string, unknown> | null;
    if (!b || typeof b !== 'object') return { error: `bookings[${i}] must be an object` };
    const trial_code = typeof b.trial_code === 'string' ? b.trial_code.trim() : '';
    const start_at = typeof b.start_at === 'string' ? b.start_at.trim() : '';
    if (!trial_code) return { error: `bookings[${i}].trial_code is required` };
    if (!ISODATETIME.test(start_at)) return { error: `bookings[${i}].start_at must be 'YYYY-MM-DDTHH:MM'` };
    out.push({ trial_code, start_at });
  }
  return out;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Body must be valid JSON.' }, 400);
  }

  const validated = validateIntake(raw);
  if (!validated.ok) {
    return jsonResponse({ ok: false, error: 'Validation failed', errors: validated.errors }, 422);
  }
  const input = validated.data;

  const bookingsParsed = parseBookings((raw as Record<string, unknown>).bookings);
  if (!Array.isArray(bookingsParsed)) {
    return jsonResponse({ ok: false, error: bookingsParsed.error }, 422);
  }
  const requestedBookings: BookingInput[] = bookingsParsed;
  const trialIntentions: string[] = parseTrialIntentions((raw as Record<string, unknown>).trial_intentions);

  // Confirm event
  const event = await queryFirst<EventRow>(
    env,
    `SELECT id, name, kind, starts_on, ends_on FROM events WHERE id = ? AND active = 1`,
    input.event_id
  );
  if (!event) return jsonResponse({ ok: false, error: 'Unknown event.' }, 422);

  // Validate each requested booking against catalog + windows + existing bookings.
  let catalogByCode = new Map<string, CatalogRow>();
  let windows: WindowRow[] = [];
  let existingBookings: BookingRow[] = [];

  if (requestedBookings.length > 0) {
    const codes = Array.from(new Set(requestedBookings.map((b) => b.trial_code)));
    const placeholders = codes.map(() => '?').join(',');
    const catalogRows = await queryAll<CatalogRow>(
      env,
      `SELECT code, bookable, duration_minutes, buffer_minutes
         FROM trial_catalog WHERE code IN (${placeholders})`,
      ...codes
    );
    catalogByCode = new Map(catalogRows.map((r) => [r.code, r]));
    windows = await queryAll<WindowRow>(
      env,
      `SELECT day_date, start_time, end_time FROM event_schedule_window WHERE event_id = ?`,
      event.id
    );
    existingBookings = await queryAll<BookingRow>(
      env,
      `SELECT id, start_at, buffer_until FROM bookings
        WHERE event_id = ? AND voided_at IS NULL`,
      event.id
    );

    // Within-request collisions (a single submission asking for 2 overlapping slots)
    const requestSpans: { start_at: string; buffer_until: string; trial_code: string }[] = [];

    for (let i = 0; i < requestedBookings.length; i++) {
      const b = requestedBookings[i];
      const cat = catalogByCode.get(b.trial_code);
      if (!cat) {
        return jsonResponse({ ok: false, error: 'unknown_trial', detail: `${b.trial_code} not in catalog`, index: i }, 422);
      }
      if (!cat.bookable || !cat.duration_minutes) {
        return jsonResponse({ ok: false, error: 'not_bookable', detail: `${b.trial_code} is not bookable`, index: i }, 422);
      }
      const end_at = addMinutes(b.start_at, cat.duration_minutes);
      const buffer_until = addMinutes(end_at, cat.buffer_minutes);

      // Window check
      const fitsAny = windows.some((w) => {
        const winStart = `${w.day_date}T${w.start_time}`;
        const winEnd = `${w.day_date}T${w.end_time}`;
        return b.start_at >= winStart && buffer_until <= winEnd;
      });
      if (!fitsAny) {
        return jsonResponse(
          { ok: false, error: 'no_window', detail: `Slot does not fit inside any working window`, trial_code: b.trial_code, start_at: b.start_at, index: i },
          422
        );
      }

      // Existing bookings collision
      const eConflict = existingBookings.some((eb) => overlaps(b.start_at, buffer_until, eb.start_at, eb.buffer_until));
      if (eConflict) {
        return jsonResponse(
          { ok: false, error: 'slot_taken', detail: `Slot was just booked. Please refresh and pick another.`, trial_code: b.trial_code, start_at: b.start_at, index: i },
          422
        );
      }

      // Within-request collision (booking N overlaps booking M)
      const rConflict = requestSpans.some((rs) => overlaps(b.start_at, buffer_until, rs.start_at, rs.buffer_until));
      if (rConflict) {
        return jsonResponse(
          { ok: false, error: 'self_overlap', detail: `Two of your selected trial slots overlap.`, trial_code: b.trial_code, start_at: b.start_at, index: i },
          422
        );
      }

      requestSpans.push({ start_at: b.start_at, buffer_until, trial_code: b.trial_code });
    }
  }

  // All checks passed — write the seeker, registration, and bookings.
  const now = Math.floor(Date.now() / 1000);
  const submittedAtIso = new Date(now * 1000).toISOString();
  const emailNormalized = normalizeEmail(input.email);
  const ringsJson = JSON.stringify(input.rings_pursued);

  const existing = await queryFirst<SeekerRow>(
    env,
    `SELECT id, name, email FROM seekers WHERE email_normalized = ? LIMIT 1`,
    emailNormalized
  );

  let seekerId: string;
  if (existing) {
    seekerId = existing.id;
    await exec(
      env,
      `UPDATE seekers SET name = ?, email = ?, house = ?, rings_pursued = ? WHERE id = ?`,
      input.name, input.email, input.house, ringsJson, seekerId
    );
  } else {
    seekerId = crypto.randomUUID();
    await exec(
      env,
      `INSERT INTO seekers (id, name, email, email_normalized, house, rings_pursued, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      seekerId, input.name, input.email, emailNormalized, input.house, ringsJson, now
    );
  }

  const registrationId = crypto.randomUUID();
  await exec(
    env,
    `INSERT INTO registrations (id, seeker_id, event_id, preferred_date, preferred_time, rings_pursued, email_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    registrationId, seekerId, event.id, input.preferred_date, input.preferred_time, ringsJson, now
  );

  const insertedBookings: { id: string; trial_code: string; start_at: string; end_at: string }[] = [];
  for (const b of requestedBookings) {
    const cat = catalogByCode.get(b.trial_code)!;
    const end_at = addMinutes(b.start_at, cat.duration_minutes!);
    const buffer_until = addMinutes(end_at, cat.buffer_minutes);
    const id = crypto.randomUUID();
    await exec(
      env,
      `INSERT INTO bookings (id, registration_id, seeker_id, event_id, trial_code, start_at, end_at, buffer_until, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, registrationId, seekerId, event.id, b.trial_code, b.start_at, end_at, buffer_until, 'public/seeker', now
    );
    insertedBookings.push({ id, trial_code: b.trial_code, start_at: b.start_at, end_at });
  }

  // Background email send + status update.
  waitUntil(
    (async () => {
      const status = await sendBothEmails(env, {
        name: input.name,
        email: input.email,
        house: input.house,
        rings_pursued: input.rings_pursued,
        event_name: event.name,
        event_starts_on: event.starts_on,
        event_ends_on: event.ends_on,
        preferred_date: input.preferred_date,
        preferred_time: input.preferred_time,
        submitted_at_iso: submittedAtIso,
        bookings: insertedBookings.map((b) => ({
          trial_code: b.trial_code,
          start_at: b.start_at,
          end_at: b.end_at,
        })),
        trial_intentions: trialIntentions,
      });
      const final = status.seeker === 'sent' && status.admin === 'sent' ? 'sent' : 'failed';
      try {
        await exec(env, `UPDATE registrations SET email_status = ? WHERE id = ?`, final, registrationId);
      } catch (err) {
        console.error('[intake] failed to update email_status', err);
      }
    })()
  );

  return jsonResponse(
    { ok: true, seeker_id: seekerId, registration_id: registrationId, bookings: insertedBookings },
    201
  );
};
