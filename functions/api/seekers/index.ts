// POST /api/seekers
// Public seeker intake.
// 1. Validate input.
// 2. Look up the chosen event (must exist + be active).
// 3. Upsert the seeker row matched on email_normalized.
// 4. Insert a registration row, email_status='pending'.
// 5. Return 201 immediately; fire-and-forget the two emails via ctx.waitUntil.
// 6. After Resend resolves, update registrations.email_status to 'sent' or 'failed'.
//
// The registration succeeds even if email fails — losing an intake because
// Resend is down would be worse than a missed email. The Keeper sees a
// 'failed' badge in the admin panel (Phase 2) and can resend manually.

import type { Env } from '../../lib/db';
import { queryFirst, exec } from '../../lib/db';
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

export const onRequestPost: PagesFunction<Env> = async ({ request, env, waitUntil }) => {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: 'Body must be valid JSON.' }, 400);
  }

  const result = validateIntake(raw);
  if (!result.ok) {
    return jsonResponse({ ok: false, error: 'Validation failed', errors: result.errors }, 422);
  }
  const input = result.data;

  // Confirm the event exists and is active.
  const event = await queryFirst<EventRow>(
    env,
    `SELECT id, name, kind, starts_on, ends_on FROM events WHERE id = ? AND active = 1`,
    input.event_id
  );
  if (!event) {
    return jsonResponse({ ok: false, error: 'Unknown event.' }, 422);
  }

  const now = Math.floor(Date.now() / 1000);
  const submittedAtIso = new Date(now * 1000).toISOString();
  const emailNormalized = normalizeEmail(input.email);
  const ringsJson = JSON.stringify(input.rings_pursued);

  // Upsert seeker by normalized email. If a seeker exists, update their latest
  // name/house/rings to match the most recent intake (people change houses).
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
      `UPDATE seekers
          SET name = ?, email = ?, house = ?, rings_pursued = ?
        WHERE id = ?`,
      input.name,
      input.email,
      input.house,
      ringsJson,
      seekerId
    );
  } else {
    seekerId = crypto.randomUUID();
    await exec(
      env,
      `INSERT INTO seekers (id, name, email, email_normalized, house, rings_pursued, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      seekerId,
      input.name,
      input.email,
      emailNormalized,
      input.house,
      ringsJson,
      now
    );
  }

  const registrationId = crypto.randomUUID();
  await exec(
    env,
    `INSERT INTO registrations (id, seeker_id, event_id, preferred_date, rings_pursued, email_status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    registrationId,
    seekerId,
    event.id,
    input.preferred_date,
    ringsJson,
    now
  );

  // Background email send + status update. Don't block the response.
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
        submitted_at_iso: submittedAtIso,
      });
      const final = status.seeker === 'sent' && status.admin === 'sent' ? 'sent' : 'failed';
      try {
        await exec(
          env,
          `UPDATE registrations SET email_status = ? WHERE id = ?`,
          final,
          registrationId
        );
      } catch (err) {
        console.error('[intake] failed to update email_status', err);
      }
    })()
  );

  return jsonResponse(
    { ok: true, seeker_id: seekerId, registration_id: registrationId },
    201
  );
};
