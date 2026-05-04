// GET    /api/admin/seekers/:id  — full seeker record + Trial Scroll + awards
// PATCH  /api/admin/seekers/:id  — edit name / house / notes
// DELETE /api/admin/seekers/:id  — hard delete (cascades)

import type { Env } from '../../../lib/db';
import { queryFirst, queryAll, exec, audit } from '../../../lib/db';
import { jsonResponse } from '../../../_middleware';
import type { AdminContextData } from '../_middleware';

export const onRequestGet: PagesFunction<Env, 'id', AdminContextData> = async ({ env, params }) => {
  const id = String(params.id);
  const seeker = await queryFirst<Record<string, unknown>>(
    env,
    `SELECT * FROM seekers WHERE id = ?`,
    id
  );
  if (!seeker) return jsonResponse({ ok: false, error: 'Not found' }, 404);

  const registrations = await queryAll(
    env,
    `SELECT r.*, e.name AS event_name, e.kind AS event_kind, e.starts_on, e.ends_on
       FROM registrations r LEFT JOIN events e ON e.id = r.event_id
      WHERE r.seeker_id = ?
      ORDER BY r.created_at DESC`,
    id
  );
  const trial_events = await queryAll(
    env,
    `SELECT te.*, tc.name AS trial_name, tc.pillar, tc.tier
       FROM trial_events te JOIN trial_catalog tc ON tc.code = te.trial_code
      WHERE te.seeker_id = ?
      ORDER BY te.completed_on DESC, te.created_at DESC`,
    id
  );
  const awards = await queryAll(
    env,
    `SELECT * FROM awards WHERE seeker_id = ? ORDER BY awarded_on DESC`,
    id
  );
  const progress = await queryAll(
    env,
    `SELECT trial_code, completed FROM v_seeker_progress WHERE seeker_id = ?`,
    id
  );

  const bookings = await queryAll(
    env,
    `SELECT b.id, b.trial_code, b.start_at, b.end_at, b.event_id, b.voided_at,
            tc.name AS trial_name, tc.pillar, tc.tier,
            e.name AS event_name
       FROM bookings b
       JOIN trial_catalog tc ON tc.code = b.trial_code
       LEFT JOIN events e ON e.id = b.event_id
      WHERE b.seeker_id = ?
      ORDER BY b.start_at`,
    id
  );

  return jsonResponse({ seeker, registrations, trial_events, awards, progress, bookings });
};

export const onRequestPatch: PagesFunction<Env, 'id', AdminContextData> = async ({ request, env, params, data }) => {
  const id = String(params.id);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ ok: false, error: 'JSON body required' }, 400);

  const updates: string[] = [];
  const binds: unknown[] = [];
  for (const field of ['name', 'house', 'notes'] as const) {
    if (field in body) {
      const value = body[field];
      if (field === 'name' && (typeof value !== 'string' || !value.trim())) {
        return jsonResponse({ ok: false, error: 'name cannot be empty' }, 422);
      }
      updates.push(`${field} = ?`);
      binds.push(value === '' ? null : value);
    }
  }
  if (updates.length === 0) return jsonResponse({ ok: false, error: 'no editable fields supplied' }, 400);

  binds.push(id);
  await exec(env, `UPDATE seekers SET ${updates.join(', ')} WHERE id = ?`, ...binds);
  await audit(env, {
    actor_email: data.user.email,
    action: 'seeker.patch',
    target_type: 'seeker',
    target_id: id,
    detail: body,
  });
  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env, 'id', AdminContextData> = async ({ env, params, data }) => {
  const id = String(params.id);
  const seeker = await queryFirst<{ name: string }>(env, `SELECT name FROM seekers WHERE id = ?`, id);
  if (!seeker) return jsonResponse({ ok: false, error: 'Not found' }, 404);
  await exec(env, `DELETE FROM seekers WHERE id = ?`, id);
  await audit(env, {
    actor_email: data.user.email,
    action: 'seeker.delete',
    target_type: 'seeker',
    target_id: id,
    detail: { name: seeker.name },
  });
  return jsonResponse({ ok: true });
};
