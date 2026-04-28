// GET  /api/admin/events           — all events (active + inactive)
// POST /api/admin/events           — upsert an event (used to fill in expedition dates)
//   body: { id, name, kind, starts_on?, ends_on?, active }

import type { Env } from '../../lib/db';
import { queryAll, queryFirst, exec, audit } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import type { AdminContextData } from './_middleware';

export const onRequestGet: PagesFunction<Env, string, AdminContextData> = async ({ env }) => {
  const events = await queryAll(
    env,
    `SELECT * FROM events
      ORDER BY
        CASE kind WHEN 'expedition' THEN 0 ELSE 1 END,
        COALESCE(starts_on, '9999-99-99'),
        name`
  );
  return jsonResponse({ events });
};

export const onRequestPost: PagesFunction<Env, string, AdminContextData> = async ({ request, env, data }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ ok: false, error: 'JSON body required' }, 400);

  const id = typeof body.id === 'string' ? body.id : null;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const kind = body.kind === 'expedition' || body.kind === 'grand_gathering' ? body.kind : null;
  const starts_on = typeof body.starts_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.starts_on) ? body.starts_on : null;
  const ends_on = typeof body.ends_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.ends_on) ? body.ends_on : null;
  const active = body.active === false ? 0 : 1;

  if (!id) return jsonResponse({ ok: false, error: 'id is required' }, 422);
  if (!name) return jsonResponse({ ok: false, error: 'name is required' }, 422);
  if (!kind) return jsonResponse({ ok: false, error: 'kind must be expedition or grand_gathering' }, 422);

  const exists = await queryFirst<{ id: string }>(env, `SELECT id FROM events WHERE id = ?`, id);
  if (exists) {
    await exec(
      env,
      `UPDATE events SET name = ?, kind = ?, starts_on = ?, ends_on = ?, active = ? WHERE id = ?`,
      name, kind, starts_on, ends_on, active, id
    );
    await audit(env, { actor_email: data.user.email, action: 'event.update', target_type: 'event', target_id: id, detail: body });
    return jsonResponse({ ok: true, updated: true });
  } else {
    await exec(
      env,
      `INSERT INTO events (id, name, kind, starts_on, ends_on, active) VALUES (?, ?, ?, ?, ?, ?)`,
      id, name, kind, starts_on, ends_on, active
    );
    await audit(env, { actor_email: data.user.email, action: 'event.create', target_type: 'event', target_id: id, detail: body });
    return jsonResponse({ ok: true, created: true }, 201);
  }
};
