import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const root = fileURLToPath(new URL('../', import.meta.url));
let app, bundleDir;
before(async () => {
  bundleDir = await mkdtemp(path.join(tmpdir(), 'keepers-tests-'));
  const outfile = path.join(bundleDir, 'handlers.mjs');
  await build({
    stdin: { resolveDir: root, loader: 'ts', contents: `
      export { onRequestPost as intake } from './functions/api/seekers/index.ts';
      export { onRequestPost as lookup } from './functions/api/seekers/lookup.ts';
      export { onRequestGet as availability } from './functions/api/public/availability.ts';
      export { onRequestGet as tracker } from './functions/api/public/tracker.ts';
      export { onRequestPost as progress } from './functions/api/admin/progress.ts';
      export { onRequestDelete as voidProgress } from './functions/api/admin/progress/[id].ts';
      export { onRequestGet as seekerDetail } from './functions/api/admin/seekers/[id].ts';
      export { onRequestGet as seekers } from './functions/api/admin/seekers.ts';
      export { evaluateAwards } from './functions/lib/awards.ts';
    ` },
    bundle: true, platform: 'node', format: 'esm', outfile,
    plugins: [{ name: 'no-real-email', setup(builder) {
      builder.onLoad({ filter: /functions\/lib\/email\.ts$/ }, () => ({
        loader: 'js', contents: `export async function sendBothEmails(env) {
          env.testEmailCalls++;
          return { seeker: 'sent', admin: 'sent' };
        }`,
      }));
    } }],
  });
  app = await import(pathToFileURL(outfile));
});
after(async () => { if (bundleDir) await rm(bundleDir, { recursive: true, force: true }); });

// Split the repository's SQL migrations, preserving quoted semicolons and
// skipping line comments. No production schema snapshots or credentials needed.
function migrationStatements(sql) {
  const statements = [];
  let current = '';
  for (const token of sql.match(/--[^\n]*|'(?:[^']|'')*'|"(?:[^"]|"")*"|;|[^'";\-]+|./gs) ?? []) {
    if (token.startsWith('--')) continue;
    if (token === ';') {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else current += token;
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function database(t) {
  const mf = new Miniflare({
    modules: true, script: 'export default { fetch() { return new Response("test"); } }',
    compatibilityDate: '2024-11-01', d1Databases: { DB: crypto.randomUUID() },
  });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  const migrationDir = path.join(root, 'migrations');
  for (const file of (await readdir(migrationDir)).filter(f => f.endsWith('.sql')).sort()) {
    for (const sql of migrationStatements(await readFile(path.join(migrationDir, file), 'utf8'))) {
      await db.prepare(sql).run();
    }
  }
  const env = { DB: db, testEmailCalls: 0, SITE_URL: 'https://example.invalid',
    EMAIL_FROM: 'test@example.invalid', KEEPER_NOTIFY_EMAIL: 'test@example.invalid' };
  const call = async (handler, body, { route = '/', params = {}, method } = {}) => {
    const background = [];
    const response = await handler({
      env, params, data: { user: { email: 'keeper@example.invalid' } },
      request: new Request('https://example.invalid' + route, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
      }),
      waitUntil: p => background.push(p),
    });
    await Promise.all(background);
    return { status: response.status, data: await response.json() };
  };
  const count = async table => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
  return { db, env, call, count };
}

const payload = (extra = {}) => ({ name: 'Test Seeker', email: 'seeker@example.invalid',
  house: 'Test House', rings_pursued: ['body', 'mind', 'soul'], event_id: 'gg_2026', bookings: [], ...extra });
const slot = (trial_code = 'm_t1_recitation', time = '09:00') => ({ trial_code, start_at: `2026-11-08T${time}` });
async function register(d, extra = {}) {
  const response = await d.call(app.intake, payload(extra));
  assert.equal(response.status, 201);
  return response.data.seeker_id;
}
async function mark(d, seeker_id, trial_code, outcome = 'passed') {
  const response = await d.call(app.progress, { seeker_id, trial_code, outcome,
    event_id: 'gg_2026', completed_on: '2026-11-08' });
  assert.equal(response.status, 201);
  return response.data;
}

test('fresh migrations support registration, normalized email, lookup and booking conflicts', async t => {
  const d = await database(t);
  const id = await register(d, { bookings: [slot()] });
  assert.equal(d.env.testEmailCalls, 1);
  const found = await d.call(app.lookup, { name: 'Test Seeker', email: 'SEEKER@example.invalid' });
  assert.equal(found.data.ok, true);
  assert.equal(found.data.seeker.registrations.length, 1);
  assert.equal((await d.db.prepare('SELECT email_status FROM registrations').first()).email_status, 'sent');
  const availability = await d.call(app.availability, undefined, {
    route: '/api/public/availability?event_id=gg_2026&trial_codes=m_t1_recitation',
  });
  assert.equal(availability.data.trials.m_t1_recitation.available_starts.includes(slot().start_at), false);
  const conflict = await d.call(app.intake, payload({ email: 'second@example.invalid', bookings: [slot()] }));
  assert.equal(conflict.status, 422);
  assert.equal(conflict.data.error, 'slot_taken');
  assert.equal(await d.count('seekers'), 1);
  assert.equal(await register(d, { name: 'Renamed Seeker', email: 'SEEKER@example.invalid' }), id);
  assert.equal(await d.count('seekers'), 1);
});

test('failure on the second booking rolls back all writes and sends no email', async t => {
  const d = await database(t);
  await d.db.prepare(`CREATE TRIGGER reject_second BEFORE INSERT ON bookings
    WHEN NEW.trial_code = 'm_t1_dilemma'
    BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`).run();
  await assert.rejects(d.call(app.intake, payload({ bookings: [slot(), slot('m_t1_dilemma', '11:00')] })), /simulated failure/);
  for (const table of ['seekers', 'registrations', 'bookings']) assert.equal(await d.count(table), 0, table);
  assert.equal(d.env.testEmailCalls, 0);
});

test('failed booking also rolls back an existing seeker profile update', async t => {
  const d = await database(t);
  const id = await register(d);
  const before = await d.db.prepare('SELECT * FROM seekers WHERE id = ?').bind(id).first();
  await d.db.prepare(`CREATE TRIGGER reject_booking BEFORE INSERT ON bookings
    BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`).run();
  await assert.rejects(d.call(app.intake, payload({ name: 'Should roll back', house: 'Changed', bookings: [slot()] })), /simulated failure/);
  assert.deepEqual(await d.db.prepare('SELECT * FROM seekers WHERE id = ?').bind(id).first(), before);
  assert.equal(await d.count('registrations'), 1);
  assert.equal(await d.count('bookings'), 0);
  assert.equal(d.env.testEmailCalls, 1);
});

test('a corrected Mind result retracts and restores the ring, retaining its ID and audit history', async t => {
  const d = await database(t);
  const id = await register(d);
  await mark(d, id, 'm_t1_recitation'); // either Mind I path suffices
  const tier2 = await mark(d, id, 'm_t2');
  await mark(d, id, 'm_t3');
  const original = await d.db.prepare("SELECT * FROM awards WHERE kind = 'ring_mind'").first();
  assert.ok(original);
  const removed = await d.call(app.voidProgress, { reason: 'Correction' }, { params: { id: tier2.trial_event_id }, method: 'DELETE' });
  assert.deepEqual(removed.data.retraction.rings_retracted, ['ring_mind']);
  const restored = await mark(d, id, 'm_t2');
  assert.deepEqual(restored.awards.rings_added, ['ring_mind']);
  const current = await d.db.prepare("SELECT * FROM awards WHERE kind = 'ring_mind'").first();
  assert.equal(current.id, original.id);
  for (const field of ['revoked_at', 'revoked_by', 'revoke_reason']) assert.equal(current[field], null);
  assert.deepEqual(await app.evaluateAwards(d.env, id, 'keeper@example.invalid', 'gg_2026'), { rings_added: [], master_added: false });
  assert.equal(await d.count('awards'), 1);
  const log = await d.db.prepare("SELECT detail FROM admin_log WHERE action = 'progress.void'").first();
  assert.equal(JSON.parse(log.detail).reason, 'Correction');
});

test('Body ring and every progress view exclude the retired Course while keeping its history', async t => {
  const d = await database(t);
  const id = await register(d);
  const { results: trials } = await d.db.prepare("SELECT code FROM trial_catalog WHERE pillar = 'body' AND code <> 'b_t3_course'").all();
  for (const { code } of trials) await mark(d, id, code);
  const tracker = await d.call(app.tracker);
  assert.equal(tracker.data.seekers[0].rings.body, true);
  assert.deepEqual(tracker.data.seekers[0].pillar_counts.body, { complete: 3, total: 3 });
  const lookup = await d.call(app.lookup, { name: 'Test Seeker', email: 'seeker@example.invalid' });
  assert.deepEqual(lookup.data.seeker.pillar_counts.body, { complete: 3, total: 3 });
  // Existing historical completion remains readable, even though new ones are refused.
  await d.db.prepare(`INSERT INTO trial_events
    (id, seeker_id, trial_code, completed_on, created_by, created_at)
    VALUES ('historical-course', ?, 'b_t3_course', '2025-11-08', 'keeper@example.invalid', 1)`).bind(id).run();
  const detail = await d.call(app.seekerDetail, undefined, { params: { id } });
  assert.ok(detail.data.trial_events.some(row => row.trial_code === 'b_t3_course'));
  assert.ok(!detail.data.progress.some(row => row.trial_code === 'b_t3_course'));
  const summary = await d.call(app.seekers);
  assert.equal(summary.data.seekers[0].passed_trials, trials.length);
  const rejected = await d.call(app.progress, { seeker_id: id, trial_code: 'b_t3_course', completed_on: '2026-11-08', force: true });
  assert.equal(rejected.status, 422);
  assert.equal(rejected.data.error, 'retired_trial');
});

test('Master title restores after a correction; Shield remains manual and untouched', async t => {
  const d = await database(t);
  const id = await register(d);
  const { results: trials } = await d.db.prepare("SELECT code FROM trial_catalog WHERE code <> 'b_t3_course' ORDER BY display_order").all();
  let corrected;
  for (const { code } of trials) {
    const result = await mark(d, id, code);
    if (code === 's_t3_final_introduction') corrected = result.trial_event_id;
  }
  assert.equal(await d.count('awards'), 4); // no automatic Shield
  const master = await d.db.prepare("SELECT id FROM awards WHERE kind = 'master_title'").first();
  await d.db.prepare(`INSERT INTO awards (id, seeker_id, kind, awarded_on, created_by, created_at)
    VALUES ('manual-shield', ?, 'shield', '2026-11-08', 'keeper@example.invalid', 1)`).bind(id).run();
  const removed = await d.call(app.voidProgress, {}, { params: { id: corrected }, method: 'DELETE' });
  assert.equal(removed.data.retraction.master_retracted, true);
  const restored = await mark(d, id, 's_t3_final_introduction');
  assert.equal(restored.awards.master_added, true);
  const current = await d.db.prepare("SELECT id, revoked_at FROM awards WHERE kind = 'master_title'").first();
  assert.equal(current.id, master.id);
  assert.equal(current.revoked_at, null);
  assert.equal((await d.db.prepare("SELECT revoked_at FROM awards WHERE kind = 'shield'").first()).revoked_at, null);
  assert.equal(await d.count('awards'), 5);
});

test('failed attempts do not complete admin progress, and duplicate passes count once', async t => {
  const d = await database(t);
  const id = await register(d);
  await mark(d, id, 'b_t1', 'failed');
  let detail = await d.call(app.seekerDetail, undefined, { params: { id } });
  assert.equal(detail.data.progress.find(row => row.trial_code === 'b_t1').completed, 0);
  await mark(d, id, 'b_t1');
  await mark(d, id, 'b_t1');
  detail = await d.call(app.seekerDetail, undefined, { params: { id } });
  assert.deepEqual(detail.data.progress.filter(row => row.trial_code === 'b_t1'), [{ trial_code: 'b_t1', completed: 1 }]);
  assert.equal((await d.call(app.seekers)).data.seekers[0].passed_trials, 1);
});

test('duplicate passes cannot satisfy another required trial or unlock a higher tier', async t => {
  const d = await database(t);
  const id = await register(d);
  // Exercise an all-of prerequisite with two distinct requirements.
  await d.db.prepare("UPDATE trial_catalog SET tier_aggregation = 'all' WHERE pillar = 'mind' AND tier = 1").run();
  await d.db.prepare("UPDATE trial_catalog SET bookable = 1, duration_minutes = 30 WHERE code = 'm_t2'").run();
  await mark(d, id, 'm_t1_recitation');
  await mark(d, id, 'm_t1_recitation');
  const locked = await d.call(app.intake, payload({ bookings: [slot('m_t2')] }));
  assert.equal(locked.status, 422);
  assert.equal(locked.data.error, 'tier_locked');
  const tracker = await d.call(app.tracker);
  assert.equal(tracker.data.seekers[0].pillar_counts.mind.complete, 0);
  await mark(d, id, 'm_t1_dilemma');
  assert.equal((await d.call(app.intake, payload({ bookings: [slot('m_t2')] }))).status, 201);
});
