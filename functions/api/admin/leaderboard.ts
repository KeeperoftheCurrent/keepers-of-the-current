// POST /api/admin/leaderboard — add a Body III public-timed result.
// Body: {event_code:'plank'|'foot_race'|'course', seeker_id?, display_name, time_display, recorded_on, recorded_at_event?, notes?}

import type { Env } from '../../lib/db';
import { queryFirst, exec, audit } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import { parseSeconds } from '../../lib/validate';
import type { AdminContextData } from './_middleware';

const VALID_EVENT_CODES = ['plank', 'foot_race', 'course'] as const;

export const onRequestPost: PagesFunction<Env, string, AdminContextData> = async ({ request, env, data }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ ok: false, error: 'JSON body required' }, 400);

  const event_code = typeof body.event_code === 'string' ? body.event_code : null;
  const seeker_id = typeof body.seeker_id === 'string' && body.seeker_id ? body.seeker_id : null;
  const display_name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const time_display = typeof body.time_display === 'string' ? body.time_display.trim() : '';
  const recorded_on = typeof body.recorded_on === 'string' ? body.recorded_on.trim() : '';
  const recorded_at_event = typeof body.recorded_at_event === 'string' && body.recorded_at_event ? body.recorded_at_event : null;
  const notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;

  const errors: string[] = [];
  if (!event_code || !VALID_EVENT_CODES.includes(event_code as typeof VALID_EVENT_CODES[number]))
    errors.push('event_code must be plank, foot_race, or course');
  if (!display_name) errors.push('display_name is required');
  if (!time_display) errors.push('time_display is required');
  if (!recorded_on || !/^\d{4}-\d{2}-\d{2}$/.test(recorded_on)) errors.push('recorded_on must be YYYY-MM-DD');
  const time_seconds = parseSeconds(time_display);
  if (time_seconds === null || time_seconds < 0) errors.push('time_display could not be parsed');
  if (errors.length) return jsonResponse({ ok: false, error: 'Validation failed', errors }, 422);

  if (seeker_id) {
    const seeker = await queryFirst<{ id: string }>(env, `SELECT id FROM seekers WHERE id = ?`, seeker_id);
    if (!seeker) return jsonResponse({ ok: false, error: 'Unknown seeker' }, 422);
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await exec(
    env,
    `INSERT INTO leaderboard_times (id, event_code, seeker_id, display_name, time_seconds, time_display, recorded_at_event, recorded_on, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    event_code,
    seeker_id,
    display_name,
    time_seconds,
    time_display,
    recorded_at_event,
    recorded_on,
    notes,
    data.user.email,
    now
  );

  await audit(env, {
    actor_email: data.user.email,
    action: 'leaderboard.add',
    target_type: 'leaderboard_time',
    target_id: id,
    detail: { event_code, display_name, time_display, recorded_on },
  });

  return jsonResponse({ ok: true, time_id: id }, 201);
};
