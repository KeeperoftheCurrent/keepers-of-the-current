// POST /api/admin/progress
// Records a trial completion event (the Trial Scroll entry).
// Body: {seeker_id, trial_code, completed_on, event_id?, witness?, note?, outcome:'passed'|'failed', force?:bool}
// On 'passed' insert: triggers evaluateAwards for ring/title auto-conferral.
// Body III gg_only enforcement: refuses unless event.kind = 'grand_gathering'
// or force=true (logged).

import type { Env } from '../../lib/db';
import { queryFirst, exec, audit } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import { evaluateAwards } from '../../lib/awards';
import type { AdminContextData } from './_middleware';

interface CatalogRow {
  code: string;
  pillar: string;
  tier: number;
  gg_only: number;
}

export const onRequestPost: PagesFunction<Env, string, AdminContextData> = async ({ request, env, data }) => {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ ok: false, error: 'JSON body required' }, 400);

  const seeker_id = typeof body.seeker_id === 'string' ? body.seeker_id : null;
  const trial_code = typeof body.trial_code === 'string' ? body.trial_code : null;
  const completed_on = typeof body.completed_on === 'string' ? body.completed_on : null;
  const event_id = typeof body.event_id === 'string' && body.event_id ? body.event_id : null;
  const witness = typeof body.witness === 'string' && body.witness.trim() ? body.witness.trim() : null;
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : null;
  const outcome = body.outcome === 'failed' ? 'failed' : 'passed';
  const force = body.force === true;

  const errors: string[] = [];
  if (!seeker_id) errors.push('seeker_id is required');
  if (!trial_code) errors.push('trial_code is required');
  if (!completed_on || !/^\d{4}-\d{2}-\d{2}$/.test(completed_on)) errors.push('completed_on must be YYYY-MM-DD');
  if (errors.length) return jsonResponse({ ok: false, error: 'Validation failed', errors }, 422);

  const seeker = await queryFirst<{ id: string }>(env, `SELECT id FROM seekers WHERE id = ?`, seeker_id);
  if (!seeker) return jsonResponse({ ok: false, error: 'Unknown seeker' }, 422);

  const catalog = await queryFirst<CatalogRow>(
    env,
    `SELECT code, pillar, tier, gg_only FROM trial_catalog WHERE code = ?`,
    trial_code
  );
  if (!catalog) return jsonResponse({ ok: false, error: 'Unknown trial_code' }, 422);

  // Body III gg_only enforcement
  if (catalog.gg_only && event_id) {
    const ev = await queryFirst<{ kind: string }>(env, `SELECT kind FROM events WHERE id = ?`, event_id);
    if (!ev) return jsonResponse({ ok: false, error: 'Unknown event_id' }, 422);
    if (ev.kind !== 'grand_gathering' && !force) {
      return jsonResponse(
        {
          ok: false,
          error: 'gg_only',
          detail: `Trial ${trial_code} may only be attempted at a Grand Gathering. Override with force:true (logged).`,
        },
        422
      );
    }
  } else if (catalog.gg_only && !event_id && !force) {
    return jsonResponse(
      { ok: false, error: 'gg_only', detail: 'Body III trials require a Grand Gathering event_id (or force:true).' },
      422
    );
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await exec(
    env,
    `INSERT INTO trial_events (id, seeker_id, trial_code, event_id, completed_on, witness, note, created_by, created_at, outcome)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    seeker_id,
    trial_code,
    event_id,
    completed_on,
    witness,
    note,
    data.user.email,
    now,
    outcome
  );

  let evalResult: Awaited<ReturnType<typeof evaluateAwards>> | null = null;
  if (outcome === 'passed') {
    evalResult = await evaluateAwards(env, seeker_id, data.user.email, event_id);
  }

  await audit(env, {
    actor_email: data.user.email,
    action: 'progress.mark',
    target_type: 'trial_event',
    target_id: id,
    detail: { seeker_id, trial_code, outcome, force, event_id, evalResult },
  });

  return jsonResponse({ ok: true, trial_event_id: id, awards: evalResult }, 201);
};
