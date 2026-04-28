// GET /api/admin/events/:id/schedule
// Per-event timeline view: windows + bookings inside them, plus the seekers
// registered for this event but with no specific booking yet ("open" registrations).

import type { Env } from '../../../../lib/db';
import { queryFirst, queryAll } from '../../../../lib/db';
import { jsonResponse } from '../../../../_middleware';
import type { AdminContextData } from '../../_middleware';

export const onRequestGet: PagesFunction<Env, 'id', AdminContextData> = async ({ env, params }) => {
  const event_id = String(params.id);
  const event = await queryFirst<{ id: string; name: string; kind: string; starts_on: string | null; ends_on: string | null }>(
    env,
    `SELECT id, name, kind, starts_on, ends_on FROM events WHERE id = ?`,
    event_id
  );
  if (!event) return jsonResponse({ ok: false, error: 'Unknown event' }, 404);

  const windows = await queryAll(
    env,
    `SELECT id, day_date, start_time, end_time, notes
       FROM event_schedule_window WHERE event_id = ?
      ORDER BY day_date, start_time`,
    event_id
  );

  const bookings = await queryAll(
    env,
    `SELECT b.id, b.registration_id, b.seeker_id, b.trial_code,
            b.start_at, b.end_at, b.buffer_until, b.notes,
            s.name AS seeker_name, s.email AS seeker_email, s.house,
            tc.name AS trial_name, tc.pillar, tc.tier,
            tc.duration_minutes, tc.buffer_minutes
       FROM bookings b
       JOIN seekers s ON s.id = b.seeker_id
       JOIN trial_catalog tc ON tc.code = b.trial_code
      WHERE b.event_id = ? AND b.voided_at IS NULL
      ORDER BY b.start_at`,
    event_id
  );

  // Open registrations: registered for this event but with zero active bookings
  const open_registrations = await queryAll(
    env,
    `SELECT r.id AS registration_id, r.created_at, r.preferred_date, r.preferred_time, r.email_status,
            s.id AS seeker_id, s.name AS seeker_name, s.email AS seeker_email, s.house, s.rings_pursued
       FROM registrations r JOIN seekers s ON s.id = r.seeker_id
      WHERE r.event_id = ? AND r.voided_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.registration_id = r.id AND b.voided_at IS NULL)
      ORDER BY r.created_at`,
    event_id
  );

  return jsonResponse({ event, windows, bookings, open_registrations });
};
