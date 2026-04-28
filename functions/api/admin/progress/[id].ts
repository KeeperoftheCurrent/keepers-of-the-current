// DELETE /api/admin/progress/:id — soft-delete (void) a trial_events row.
// Body: { reason?: string }
// Triggers retractAwardsIfNeeded after the void.

import type { Env } from '../../../lib/db';
import { queryFirst, exec, audit } from '../../../lib/db';
import { jsonResponse } from '../../../_middleware';
import { retractAwardsIfNeeded } from '../../../lib/awards';
import type { AdminContextData } from '../_middleware';

export const onRequestDelete: PagesFunction<Env, 'id', AdminContextData> = async ({ request, env, params, data }) => {
  const id = String(params.id);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;

  const row = await queryFirst<{ seeker_id: string; trial_code: string; voided_at: number | null }>(
    env,
    `SELECT seeker_id, trial_code, voided_at FROM trial_events WHERE id = ?`,
    id
  );
  if (!row) return jsonResponse({ ok: false, error: 'Not found' }, 404);
  if (row.voided_at) return jsonResponse({ ok: false, error: 'Already voided' }, 409);

  const now = Math.floor(Date.now() / 1000);
  await exec(
    env,
    `UPDATE trial_events SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?`,
    now,
    data.user.email,
    reason,
    id
  );

  const retraction = await retractAwardsIfNeeded(env, row.seeker_id, data.user.email);

  await audit(env, {
    actor_email: data.user.email,
    action: 'progress.void',
    target_type: 'trial_event',
    target_id: id,
    detail: { seeker_id: row.seeker_id, trial_code: row.trial_code, reason, retraction },
  });

  return jsonResponse({ ok: true, retraction });
};
