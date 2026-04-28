// POST /api/admin/awards
// Confer the Shield of the Current. Rings + Master title are auto-conferred
// elsewhere; this endpoint refuses those kinds.

import type { Env } from '../../lib/db';
import { queryFirst, exec, audit } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import type { AdminContextData } from './_middleware';

export const onRequestPost: PagesFunction<Env, string, AdminContextData> = async ({ request, env, data }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ ok: false, error: 'JSON body required' }, 400);

  const seeker_id = typeof body.seeker_id === 'string' ? body.seeker_id : null;
  const kind = typeof body.kind === 'string' ? body.kind : null;
  const awarded_on = typeof body.awarded_on === 'string' ? body.awarded_on : new Date().toISOString().slice(0, 10);
  const event_id = typeof body.event_id === 'string' && body.event_id ? body.event_id : null;
  const ceremony_note = typeof body.ceremony_note === 'string' && body.ceremony_note.trim() ? body.ceremony_note.trim() : null;

  if (!seeker_id) return jsonResponse({ ok: false, error: 'seeker_id is required' }, 422);
  if (kind !== 'shield')
    return jsonResponse({ ok: false, error: 'This endpoint accepts kind=shield only. Rings and Master title auto-confer.' }, 422);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(awarded_on))
    return jsonResponse({ ok: false, error: 'awarded_on must be YYYY-MM-DD' }, 422);

  const seeker = await queryFirst<{ id: string }>(env, `SELECT id FROM seekers WHERE id = ?`, seeker_id);
  if (!seeker) return jsonResponse({ ok: false, error: 'Unknown seeker' }, 422);

  const masterCheck = await queryFirst<{ kind: string }>(
    env,
    `SELECT kind FROM awards WHERE seeker_id = ? AND kind = 'master_title' AND revoked_at IS NULL`,
    seeker_id
  );
  if (!masterCheck) {
    return jsonResponse(
      { ok: false, error: 'Shield can only be granted to a Master of the Three Rings.' },
      422
    );
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  try {
    await exec(
      env,
      `INSERT INTO awards (id, seeker_id, kind, awarded_on, event_id, ceremony_note, auto_conferred, created_by, created_at)
       VALUES (?, ?, 'shield', ?, ?, ?, 0, ?, ?)`,
      id,
      seeker_id,
      awarded_on,
      event_id,
      ceremony_note,
      data.user.email,
      now
    );
  } catch (err) {
    if (String(err).includes('UNIQUE')) {
      return jsonResponse({ ok: false, error: 'Seeker already holds a Shield.' }, 409);
    }
    throw err;
  }

  await audit(env, {
    actor_email: data.user.email,
    action: 'award.shield',
    target_type: 'award',
    target_id: id,
    detail: { seeker_id, awarded_on, event_id, ceremony_note },
  });

  return jsonResponse({ ok: true, award_id: id }, 201);
};
