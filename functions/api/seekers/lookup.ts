// POST /api/seekers/lookup
// Public seeker self-lookup by name + email. Returns sanitized progress + rings.
// No-match returns { ok: false } — same response shape as bad-name and bad-email
// to avoid enumeration.

import type { Env } from '../../lib/db';
import { queryFirst, queryAll } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import { normalizeEmail } from '../../lib/validate';

interface SeekerRow {
  id: string;
  name: string;
  house: string | null;
  rings_pursued: string;
  created_at: number;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ ok: false }, 200);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  if (!name || !email) return jsonResponse({ ok: false }, 200);

  const seeker = await queryFirst<SeekerRow>(
    env,
    `SELECT id, name, house, rings_pursued, created_at
       FROM seekers
      WHERE email_normalized = ? AND lower(name) = lower(?)
      LIMIT 1`,
    normalizeEmail(email),
    name
  );
  if (!seeker) return jsonResponse({ ok: false }, 200);

  // Per-tier completion (same shape as the public tracker)
  type Pillar = 'body' | 'mind' | 'soul';
  const tierRows = await queryAll<{
    pillar: Pillar; tier: number; tier_aggregation: 'all' | 'any';
    total_codes: number; passed_codes: number;
  }>(
    env,
    `SELECT
        tc.pillar, tc.tier, tc.tier_aggregation,
        COUNT(*) AS total_codes,
        SUM(CASE WHEN te.id IS NOT NULL THEN 1 ELSE 0 END) AS passed_codes
       FROM trial_catalog tc
       LEFT JOIN trial_events te
         ON te.trial_code = tc.code
        AND te.seeker_id = ?
        AND te.voided_at IS NULL
        AND te.outcome = 'passed'
       GROUP BY tc.pillar, tc.tier, tc.tier_aggregation`,
    seeker.id
  );
  const PILLARS: Pillar[] = ['body', 'mind', 'soul'];
  const tiersComplete: Record<Pillar, number> = { body: 0, mind: 0, soul: 0 };
  const tiersTotal: Record<Pillar, number> = { body: 0, mind: 0, soul: 0 };
  for (const r of tierRows) {
    tiersTotal[r.pillar]++;
    const complete = r.tier_aggregation === 'all'
      ? r.passed_codes === r.total_codes
      : r.passed_codes >= 1;
    if (complete) tiersComplete[r.pillar]++;
  }

  const awards = await queryAll<{ kind: string; awarded_on: string }>(
    env,
    `SELECT kind, awarded_on FROM awards
      WHERE seeker_id = ? AND revoked_at IS NULL ORDER BY awarded_on DESC`,
    seeker.id
  );
  const awardKinds = new Set(awards.map((a) => a.kind));

  const registrations = await queryAll<{
    event_id: string; event_name: string | null; preferred_date: string | null; preferred_time: string | null; created_at: number;
  }>(
    env,
    `SELECT r.event_id, e.name AS event_name, r.preferred_date, r.preferred_time, r.created_at
       FROM registrations r LEFT JOIN events e ON e.id = r.event_id
      WHERE r.seeker_id = ? AND r.voided_at IS NULL
      ORDER BY r.created_at DESC`,
    seeker.id
  );

  return jsonResponse({
    ok: true,
    seeker: {
      name: seeker.name,
      house: seeker.house,
      rings_pursued: safeJsonParse(seeker.rings_pursued, []),
      pillar_counts: {
        body: { complete: tiersComplete.body, total: tiersTotal.body },
        mind: { complete: tiersComplete.mind, total: tiersTotal.mind },
        soul: { complete: tiersComplete.soul, total: tiersTotal.soul },
      },
      rings: {
        body: awardKinds.has('ring_body'),
        mind: awardKinds.has('ring_mind'),
        soul: awardKinds.has('ring_soul'),
      },
      master_of_three_rings: awardKinds.has('master_title'),
      shield: awardKinds.has('shield'),
      awards_timeline: awards,
      registrations,
    },
  });
};

function safeJsonParse(s: string | null, fallback: unknown): unknown {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
