// GET /api/public/tracker
// Sanitized public Trial Tracker — pillar counts + earned rings + Master/Shield titles.
// Excludes email, Keeper notes, witness names, and per-trial completion details
// (per locked decision 2026-04-28).

import type { Env } from '../../lib/db';
import { queryAll } from '../../lib/db';
import { jsonResponse } from '../../_middleware';

interface Row {
  seeker_id: string;
  name: string;
  house: string | null;
  pillar: 'body' | 'mind' | 'soul';
  tier: number;
  tier_complete: number; // derived per tier
  award_kinds: string;   // CSV from group_concat
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  // Compute per-tier completion using tier_aggregation rules (same as awards.ts).
  // For the public tracker we don't need to expose per-trial rows — just per-tier booleans.
  const rows = await queryAll<{
    seeker_id: string; name: string; house: string | null;
    pillar: string; tier: number; tier_aggregation: 'all' | 'any';
    total_codes: number; passed_codes: number;
  }>(
    env,
    `SELECT
        s.id AS seeker_id, s.name, s.house,
        tc.pillar, tc.tier, tc.tier_aggregation,
        COUNT(*) AS total_codes,
        SUM(CASE WHEN te.id IS NOT NULL THEN 1 ELSE 0 END) AS passed_codes
       FROM seekers s
       CROSS JOIN trial_catalog tc
       LEFT JOIN trial_events te
         ON te.seeker_id = s.id
        AND te.trial_code = tc.code
        AND te.voided_at IS NULL
        AND te.outcome = 'passed'
       GROUP BY s.id, s.name, s.house, tc.pillar, tc.tier, tc.tier_aggregation`
  );

  // Active awards per seeker
  const awards = await queryAll<{ seeker_id: string; kind: string }>(
    env,
    `SELECT seeker_id, kind FROM awards WHERE revoked_at IS NULL`
  );
  const awardsBySeeker = new Map<string, Set<string>>();
  for (const a of awards) {
    if (!awardsBySeeker.has(a.seeker_id)) awardsBySeeker.set(a.seeker_id, new Set());
    awardsBySeeker.get(a.seeker_id)!.add(a.kind);
  }

  // Pivot: per seeker, count completed tiers per pillar
  type Pillar = 'body' | 'mind' | 'soul';
  const PILLARS: Pillar[] = ['body', 'mind', 'soul'];
  const seekerMap = new Map<string, { name: string; house: string | null; tiers: Record<Pillar, Set<number>>; totalTiers: Record<Pillar, Set<number>> }>();

  for (const r of rows) {
    if (!seekerMap.has(r.seeker_id)) {
      seekerMap.set(r.seeker_id, {
        name: r.name,
        house: r.house,
        tiers: { body: new Set(), mind: new Set(), soul: new Set() },
        totalTiers: { body: new Set(), mind: new Set(), soul: new Set() },
      });
    }
    const entry = seekerMap.get(r.seeker_id)!;
    entry.totalTiers[r.pillar as Pillar].add(r.tier);
    const complete = r.tier_aggregation === 'all'
      ? r.passed_codes === r.total_codes
      : r.passed_codes >= 1;
    if (complete) entry.tiers[r.pillar as Pillar].add(r.tier);
  }

  const seekers = Array.from(seekerMap.entries()).map(([id, entry]) => {
    const kinds = awardsBySeeker.get(id) ?? new Set<string>();
    const counts: Record<Pillar, { complete: number; total: number }> = {
      body: { complete: entry.tiers.body.size, total: entry.totalTiers.body.size },
      mind: { complete: entry.tiers.mind.size, total: entry.totalTiers.mind.size },
      soul: { complete: entry.tiers.soul.size, total: entry.totalTiers.soul.size },
    };
    return {
      name: entry.name,
      house: entry.house,
      pillar_counts: counts,
      rings: {
        body: kinds.has('ring_body'),
        mind: kinds.has('ring_mind'),
        soul: kinds.has('ring_soul'),
      },
      master_of_three_rings: kinds.has('master_title'),
      shield: kinds.has('shield'),
    };
  });

  // Sort: shields first, then masters, then by ring count, then by total completed tiers, then alphabetical
  seekers.sort((a, b) => {
    const aRank = (a.shield ? 1000 : 0) + (a.master_of_three_rings ? 500 : 0)
      + (Number(a.rings.body) + Number(a.rings.mind) + Number(a.rings.soul)) * 50
      + a.pillar_counts.body.complete + a.pillar_counts.mind.complete + a.pillar_counts.soul.complete;
    const bRank = (b.shield ? 1000 : 0) + (b.master_of_three_rings ? 500 : 0)
      + (Number(b.rings.body) + Number(b.rings.mind) + Number(b.rings.soul)) * 50
      + b.pillar_counts.body.complete + b.pillar_counts.mind.complete + b.pillar_counts.soul.complete;
    if (aRank !== bRank) return bRank - aRank;
    return a.name.localeCompare(b.name);
  });

  return jsonResponse({ seekers });
};
