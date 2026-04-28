// GET /api/admin/log?limit=100 — last N admin actions.

import type { Env } from '../../lib/db';
import { queryAll } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import type { AdminContextData } from './_middleware';

export const onRequestGet: PagesFunction<Env, string, AdminContextData> = async ({ request, env }) => {
  const url = new URL(request.url);
  const limitRaw = parseInt(url.searchParams.get('limit') || '100', 10);
  const limit = Math.max(1, Math.min(500, isNaN(limitRaw) ? 100 : limitRaw));
  const entries = await queryAll(
    env,
    `SELECT id, ts, actor_email, action, target_type, target_id, detail
       FROM admin_log
      ORDER BY ts DESC
      LIMIT ?`,
    limit
  );
  return jsonResponse({ entries });
};
