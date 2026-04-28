// DELETE /api/admin/awards/:id — revoke an award (soft-delete).
// Allowed for any award kind, including auto-conferred rings/title (admin override).

import type { Env } from '../../../lib/db';
import { queryFirst, exec, audit } from '../../../lib/db';
import { jsonResponse } from '../../../_middleware';
import type { AdminContextData } from '../_middleware';

export const onRequestDelete: PagesFunction<Env, 'id', AdminContextData> = async ({ request, env, params, data }) => {
  const id = String(params.id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

  const row = await queryFirst<{ seeker_id: string; kind: string; revoked_at: number | null }>(
    env,
    `SELECT seeker_id, kind, revoked_at FROM awards WHERE id = ?`,
    id
  );
  if (!row) return jsonResponse({ ok: false, error: 'Not found' }, 404);
  if (row.revoked_at) return jsonResponse({ ok: false, error: 'Already revoked' }, 409);

  const now = Math.floor(Date.now() / 1000);
  await exec(
    env,
    `UPDATE awards SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ?`,
    now,
    data.user.email,
    reason,
    id
  );

  await audit(env, {
    actor_email: data.user.email,
    action: 'award.revoke',
    target_type: 'award',
    target_id: id,
    detail: { seeker_id: row.seeker_id, kind: row.kind, reason },
  });

  return jsonResponse({ ok: true });
};
