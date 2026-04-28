// GET /api/admin/events/:id/windows  — list Talia's working windows for the event
// PUT /api/admin/events/:id/windows  — replace the full set of windows for the event
//   body: { windows: [{ day_date: 'YYYY-MM-DD', start_time: 'HH:MM', end_time: 'HH:MM', notes? }, ...], force?: bool }
// Refuses if any new window would orphan an existing active booking
// (i.e. a booking that would no longer fit inside any window) — unless force=true.

import type { Env } from '../../../../lib/db';
import { queryFirst, queryAll, exec, audit } from '../../../../lib/db';
import { jsonResponse } from '../../../../_middleware';
import type { AdminContextData } from '../../_middleware';

interface WindowInput {
  day_date: string;
  start_time: string;
  end_time: string;
  notes?: string | null;
}

interface BookingRow {
  id: string;
  start_at: string;
  buffer_until: string;
}

const HHMM = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
const ISODATE = /^\d{4}-\d{2}-\d{2}$/;

function parseWindows(raw: unknown): { ok: true; windows: WindowInput[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be a JSON object' };
  const arr = (raw as Record<string, unknown>).windows;
  if (!Array.isArray(arr)) return { ok: false, error: 'windows array required' };
  const out: WindowInput[] = [];
  for (let i = 0; i < arr.length; i++) {
    const w = arr[i] as Record<string, unknown>;
    const day_date = typeof w.day_date === 'string' ? w.day_date.trim() : '';
    const start_time = typeof w.start_time === 'string' ? w.start_time.trim() : '';
    const end_time = typeof w.end_time === 'string' ? w.end_time.trim() : '';
    const notes = typeof w.notes === 'string' && w.notes.trim() ? w.notes.trim() : null;
    if (!ISODATE.test(day_date)) return { ok: false, error: `windows[${i}].day_date must be YYYY-MM-DD` };
    if (!HHMM.test(start_time)) return { ok: false, error: `windows[${i}].start_time must be HH:MM (24h)` };
    if (!HHMM.test(end_time)) return { ok: false, error: `windows[${i}].end_time must be HH:MM (24h)` };
    if (start_time >= end_time) return { ok: false, error: `windows[${i}].end_time must be after start_time` };
    out.push({ day_date, start_time, end_time, notes });
  }
  return { ok: true, windows: out };
}

export const onRequestGet: PagesFunction<Env, 'id', AdminContextData> = async ({ env, params }) => {
  const event_id = String(params.id);
  const event = await queryFirst<{ id: string }>(env, `SELECT id FROM events WHERE id = ?`, event_id);
  if (!event) return jsonResponse({ ok: false, error: 'Unknown event' }, 404);
  const windows = await queryAll(
    env,
    `SELECT id, day_date, start_time, end_time, notes
       FROM event_schedule_window WHERE event_id = ?
      ORDER BY day_date, start_time`,
    event_id
  );
  return jsonResponse({ event_id, windows });
};

export const onRequestPut: PagesFunction<Env, 'id', AdminContextData> = async ({ request, env, params, data }) => {
  const event_id = String(params.id);
  const body = await request.json().catch(() => null);
  const parsed = parseWindows(body);
  if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, 422);
  const force = (body as Record<string, unknown>)?.force === true;

  const event = await queryFirst<{ id: string }>(env, `SELECT id FROM events WHERE id = ?`, event_id);
  if (!event) return jsonResponse({ ok: false, error: 'Unknown event' }, 404);

  // Check existing active bookings still fit inside the new windows (unless force)
  if (!force) {
    const bookings = await queryAll<BookingRow>(
      env,
      `SELECT id, start_at, buffer_until FROM bookings
        WHERE event_id = ? AND voided_at IS NULL`,
      event_id
    );
    const orphaned: string[] = [];
    for (const b of bookings) {
      const fitsAny = parsed.windows.some((w) => {
        const winStart = `${w.day_date}T${w.start_time}`;
        const winEnd = `${w.day_date}T${w.end_time}`;
        return b.start_at >= winStart && b.buffer_until <= winEnd;
      });
      if (!fitsAny) orphaned.push(b.id);
    }
    if (orphaned.length) {
      return jsonResponse(
        {
          ok: false,
          error: 'orphans_existing_bookings',
          detail: `${orphaned.length} active booking(s) would no longer fit inside any working window. Use force:true to override (existing bookings are preserved but may need rescheduling).`,
          orphaned_booking_ids: orphaned,
        },
        422
      );
    }
  }

  const now = Math.floor(Date.now() / 1000);
  // Replace the full set: delete existing windows for this event, insert new ones
  await exec(env, `DELETE FROM event_schedule_window WHERE event_id = ?`, event_id);
  for (const w of parsed.windows) {
    await exec(
      env,
      `INSERT INTO event_schedule_window (id, event_id, day_date, start_time, end_time, notes, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      event_id,
      w.day_date,
      w.start_time,
      w.end_time,
      w.notes ?? null,
      now,
      data.user.email
    );
  }

  await audit(env, {
    actor_email: data.user.email,
    action: 'windows.replace',
    target_type: 'event',
    target_id: event_id,
    detail: { count: parsed.windows.length, force },
  });

  return jsonResponse({ ok: true, count: parsed.windows.length });
};
