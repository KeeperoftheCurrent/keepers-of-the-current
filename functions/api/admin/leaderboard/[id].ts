// DELETE /api/admin/leaderboard/:id — remove a leaderboard entry.

import type { Env } from '../../../lib/db';
import { queryFirst, exec, audit } from '../../../lib/db';
import { jsonResponse } from '../../../_middleware';
import type { AdminContextData } from '../_middleware';

export const onRequestDelete: PagesFunction<Env, 'id', AdminContextData> = async ({ env, params, data }) => {
  const id = String(params.id);
  const row = await queryFirst<{ event_code: string; display_name: string }>(
    env,
    `SELECT event_code, display_name FROM leaderboard_times WHERE id = ?`,
    id
  );
  if (!row) return jsonResponse({ ok: false, error: 'Not found' }, 404);
  await exec(env, `DELETE FROM leaderboard_times WHERE id = ?`, id);
  await audit(env, {
    actor_email: data.user.email,
    action: 'leaderboard.delete',
    target_type: 'leaderboard_time',
    target_id: id,
    detail: row,
  });
  return jsonResponse({ ok: true });
};
