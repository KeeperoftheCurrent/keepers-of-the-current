// Auto-conferral of rings + Master of Three Rings.
// Called after every successful trial_events insert and after every void.
//
// Rules (locked 2026-04-28):
// - Ring per pillar auto-confers when every tier of that pillar has a passing
//   completion. Tier completion uses tier_aggregation:
//     'all'  → every trial_catalog row in that tier must have a passing event
//     'any'  → at least one row in that tier suffices (e.g. Mind T1: Dilemma OR Recitation)
// - Master of Three Rings auto-confers when all 3 ring awards exist.
// - Shield is NEVER auto-conferred (Keeper-tapped only).
// - On void: any auto-conferred award whose conditions no longer hold is
//   retracted automatically. Manual awards (Shield) require explicit revoke.

import { queryAll, exec, type Env } from './db';

const PILLARS = ['body', 'mind', 'soul'] as const;
type Pillar = (typeof PILLARS)[number];

const RING_KIND: Record<Pillar, string> = {
  body: 'ring_body',
  mind: 'ring_mind',
  soul: 'ring_soul',
};

interface CatalogRow {
  code: string;
  pillar: Pillar;
  tier: number;
  tier_aggregation: 'all' | 'any';
}

async function tierStatesForSeeker(
  env: Env,
  seekerId: string
): Promise<Map<Pillar, boolean>> {
  const catalog = await queryAll<CatalogRow>(
    env,
    `SELECT code, pillar, tier, tier_aggregation FROM trial_catalog`
  );
  const passed = new Set(
    (
      await queryAll<{ trial_code: string }>(
        env,
        `SELECT trial_code FROM trial_events
          WHERE seeker_id = ? AND voided_at IS NULL AND outcome = 'passed'`,
        seekerId
      )
    ).map((r) => r.trial_code)
  );

  const result = new Map<Pillar, boolean>();
  for (const pillar of PILLARS) {
    const pillarRows = catalog.filter((r) => r.pillar === pillar);
    const tiers = Array.from(new Set(pillarRows.map((r) => r.tier))).sort();
    let allTiersComplete = true;
    for (const tier of tiers) {
      const tierRows = pillarRows.filter((r) => r.tier === tier);
      const agg = tierRows[0].tier_aggregation;
      const ok =
        agg === 'all'
          ? tierRows.every((r) => passed.has(r.code))
          : tierRows.some((r) => passed.has(r.code));
      if (!ok) {
        allTiersComplete = false;
        break;
      }
    }
    result.set(pillar, allTiersComplete);
  }
  return result;
}

async function activeAwardKinds(env: Env, seekerId: string): Promise<Set<string>> {
  const rows = await queryAll<{ kind: string }>(
    env,
    `SELECT kind FROM awards WHERE seeker_id = ? AND revoked_at IS NULL`,
    seekerId
  );
  return new Set(rows.map((r) => r.kind));
}

export interface EvaluateResult {
  rings_added: string[];
  master_added: boolean;
}

export async function evaluateAwards(
  env: Env,
  seekerId: string,
  actorEmail: string,
  eventId: string | null
): Promise<EvaluateResult> {
  const tierStates = await tierStatesForSeeker(env, seekerId);
  const existing = await activeAwardKinds(env, seekerId);
  const today = new Date().toISOString().slice(0, 10);
  const now = Math.floor(Date.now() / 1000);

  const ringsAdded: string[] = [];
  for (const pillar of PILLARS) {
    const ringKind = RING_KIND[pillar];
    if (existing.has(ringKind)) continue;
    if (!tierStates.get(pillar)) continue;
    const id = crypto.randomUUID();
    await exec(
      env,
      `INSERT INTO awards (id, seeker_id, kind, awarded_on, event_id, auto_conferred, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      seekerId,
      ringKind,
      today,
      eventId,
      actorEmail,
      now
    );
    ringsAdded.push(ringKind);
    existing.add(ringKind);
  }

  let masterAdded = false;
  if (
    !existing.has('master_title') &&
    PILLARS.every((p) => existing.has(RING_KIND[p]))
  ) {
    const id = crypto.randomUUID();
    await exec(
      env,
      `INSERT INTO awards (id, seeker_id, kind, awarded_on, event_id, auto_conferred, created_by, created_at)
       VALUES (?, ?, 'master_title', ?, ?, 1, ?, ?)`,
      id,
      seekerId,
      today,
      eventId,
      actorEmail,
      now
    );
    masterAdded = true;
  }

  return { rings_added: ringsAdded, master_added: masterAdded };
}

export interface RetractResult {
  rings_retracted: string[];
  master_retracted: boolean;
}

export async function retractAwardsIfNeeded(
  env: Env,
  seekerId: string,
  actorEmail: string,
  reason = 'auto-retracted: tier no longer complete'
): Promise<RetractResult> {
  const tierStates = await tierStatesForSeeker(env, seekerId);
  const autoAwards = await queryAll<{ id: string; kind: string }>(
    env,
    `SELECT id, kind FROM awards
      WHERE seeker_id = ? AND revoked_at IS NULL AND auto_conferred = 1`,
    seekerId
  );
  const now = Math.floor(Date.now() / 1000);

  const retractedKinds = new Set<string>();
  for (const award of autoAwards) {
    if (!award.kind.startsWith('ring_')) continue;
    const pillar = award.kind.replace('ring_', '') as Pillar;
    if (tierStates.get(pillar)) continue; // still complete
    await exec(
      env,
      `UPDATE awards SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ?`,
      now,
      actorEmail,
      reason,
      award.id
    );
    retractedKinds.add(award.kind);
  }

  // Master title needs all 3 rings active
  const masterRow = autoAwards.find((a) => a.kind === 'master_title');
  let masterRetracted = false;
  if (masterRow) {
    const activeRingKinds = new Set(
      (
        await queryAll<{ kind: string }>(
          env,
          `SELECT kind FROM awards
            WHERE seeker_id = ? AND revoked_at IS NULL
              AND kind IN ('ring_body','ring_mind','ring_soul')`,
          seekerId
        )
      ).map((r) => r.kind)
    );
    if (activeRingKinds.size < 3) {
      await exec(
        env,
        `UPDATE awards SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ?`,
        now,
        actorEmail,
        'auto-retracted: a ring is no longer held',
        masterRow.id
      );
      masterRetracted = true;
    }
  }

  return {
    rings_retracted: Array.from(retractedKinds),
    master_retracted: masterRetracted,
  };
}
