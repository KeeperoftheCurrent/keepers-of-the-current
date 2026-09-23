// POST /api/seekers/lookup
// Public seeker self-lookup by name + email. Returns sanitized progress + rings.
// No-match returns { ok: false } — same response shape as bad-name and bad-email
// to avoid enumeration.

import type { Env } from '../../lib/db';
import { queryFirst, queryAll } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import { normalizeEmail } from '../../lib/validate';
import { RETIRED_TRIAL_CODE } from '../../lib/catalog';
import { eventClock } from '../../lib/event-time';

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
        COUNT(DISTINCT tc.code) AS total_codes,
        COUNT(DISTINCT te.trial_code) AS passed_codes
       FROM trial_catalog tc
       LEFT JOIN trial_events te
         ON te.trial_code = tc.code
        AND te.seeker_id = ?
        AND te.voided_at IS NULL
        AND te.outcome = 'passed'
       WHERE tc.code <> ?
       GROUP BY tc.pillar, tc.tier, tc.tier_aggregation`,
    seeker.id,
    RETIRED_TRIAL_CODE
  );
  const PILLARS: Pillar[] = ['body', 'mind', 'soul'];
  const tiersComplete: Record<Pillar, number> = { body: 0, mind: 0, soul: 0 };
  const tiersTotal: Record<Pillar, number> = { body: 0, mind: 0, soul: 0 };
  const tierProgress: Record<Pillar, { tier: number; complete: boolean }[]> = { body: [], mind: [], soul: [] };
  for (const r of tierRows) {
    tiersTotal[r.pillar]++;
    const complete = r.tier_aggregation === 'all'
      ? r.passed_codes === r.total_codes
      : r.passed_codes >= 1;
    if (complete) tiersComplete[r.pillar]++;
    tierProgress[r.pillar].push({ tier: r.tier, complete });
  }
  for (const pillar of PILLARS) tierProgress[pillar].sort((a, b) => a.tier - b.tier);
  const clock = eventClock(env.EVENT_TIME_ZONE);

  const awards = await queryAll<{ kind: string; awarded_on: string }>(
    env,
    `SELECT kind, awarded_on FROM awards
      WHERE seeker_id = ? AND revoked_at IS NULL ORDER BY awarded_on DESC`,
    seeker.id
  );
  const awardKinds = new Set(awards.map((a) => a.kind));

  const registrations = await queryAll<{
    event_id: string; event_name: string | null; starts_on: string | null; ends_on: string | null;
    event_active: number; email_status: string;
    preferred_date: string | null; preferred_time: string | null; created_at: number;
  }>(
    env,
    `SELECT r.event_id, e.name AS event_name, e.starts_on, e.ends_on, e.active AS event_active,
            r.email_status, r.preferred_date, r.preferred_time, r.created_at
       FROM registrations r LEFT JOIN events e ON e.id = r.event_id
      WHERE r.seeker_id = ? AND r.voided_at IS NULL
      ORDER BY r.created_at DESC`,
    seeker.id
  );

  // Only this seeker's active bookings; omit contact details, private notes,
  // witnesses, and internal IDs. Voiding a registration hides its bookings too.
  const bookings = await queryAll<{
    trial_name: string; pillar: Pillar; tier: number; start_at: string; end_at: string;
    event_name: string; event_active: number;
  }>(env,
    `SELECT tc.name AS trial_name, tc.pillar, tc.tier, b.start_at, b.end_at,
            e.name AS event_name, e.active AS event_active
       FROM bookings b
       JOIN registrations r ON r.id = b.registration_id
       JOIN trial_catalog tc ON tc.code = b.trial_code
       JOIN events e ON e.id = b.event_id
      WHERE b.seeker_id = ? AND r.seeker_id = ?
        AND b.voided_at IS NULL AND r.voided_at IS NULL
      ORDER BY b.start_at`, seeker.id, seeker.id);

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
      tier_progress: tierProgress,
      next_tiers: Object.fromEntries(PILLARS.map(pillar => [pillar,
        tierProgress[pillar].find(tier => !tier.complete)?.tier ?? null])),
      registrations: registrations.map(reg => ({ ...reg,
        past: (reg.ends_on ?? reg.starts_on ?? '9999-12-31') < clock.date,
      })),
      bookings: bookings.map(booking => ({ ...booking, past: booking.end_at < clock.localDateTime })),
      time_zone: clock.timeZone,
    },
  });
};

function safeJsonParse(s: string | null, fallback: unknown): unknown {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}
