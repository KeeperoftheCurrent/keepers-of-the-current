// GET /api/admin/seekers — full registry with email + house + notes + counts.
// Used by the admin panel as the seeker list view.

import type { Env } from '../../lib/db';
import { queryAll } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import type { AdminContextData } from './_middleware';

interface SeekerSummary {
  id: string;
  name: string;
  email: string;
  house: string | null;
  rings_pursued: string;
  notes: string | null;
  created_at: number;
  registrations_count: number;
  passed_trials: number;
  active_awards: string;
}

export const onRequestGet: PagesFunction<Env, string, AdminContextData> = async ({ env }) => {
  const seekers = await queryAll<SeekerSummary>(
    env,
    `SELECT
       s.id, s.name, s.email, s.house, s.rings_pursued, s.notes, s.created_at,
       (SELECT COUNT(*) FROM registrations r WHERE r.seeker_id = s.id AND r.voided_at IS NULL) AS registrations_count,
       (SELECT COUNT(*) FROM trial_events te WHERE te.seeker_id = s.id AND te.voided_at IS NULL AND te.outcome = 'passed') AS passed_trials,
       (SELECT GROUP_CONCAT(kind, ',') FROM awards a WHERE a.seeker_id = s.id AND a.revoked_at IS NULL) AS active_awards
       FROM seekers s
       ORDER BY s.created_at DESC`
  );
  // Parse rings_pursued JSON for the response
  const expanded = seekers.map((s) => ({
    ...s,
    rings_pursued: safeJsonParse(s.rings_pursued, []),
    active_awards: s.active_awards ? s.active_awards.split(',') : [],
  }));
  return jsonResponse({ seekers: expanded });
};

function safeJsonParse(s: string | null, fallback: unknown): unknown {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
