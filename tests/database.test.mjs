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
      export { onRequestGet as adminAvailability } from './functions/api/admin/availability.ts';
      export { onRequestGet as overview } from './functions/api/admin/overview.ts';
      export { onRequestPost as memberEditor } from './functions/api/members/editor.ts';
      export { onRequestPost as adminMember } from './functions/api/admin/members.ts';
      export { onRequestGet as publicMembers } from './functions/api/public/members.ts';
      export { onRequestPost as adminChronicle } from './functions/api/admin/chronicles.ts';
      export { onRequestGet as publicChronicles } from './functions/api/public/chronicles.ts';
      export { cleanPortrait } from './functions/lib/members.ts';
      export { onRequestPost as booking } from './functions/api/seekers/booking.ts';
      export { onRequestPost as intake } from './functions/api/seekers/index.ts';
      export { onRequestPost as lookup } from './functions/api/seekers/lookup.ts';
      export { onRequestGet as availability } from './functions/api/public/availability.ts';
      export { onRequestGet as tracker } from './functions/api/public/tracker.ts';
      export { onRequestPost as progress } from './functions/api/admin/progress.ts';
      export { onRequestDelete as voidProgress } from './functions/api/admin/progress/[id].ts';
      export { onRequestGet as seekerDetail } from './functions/api/admin/seekers/[id].ts';
      export { onRequestGet as seekers } from './functions/api/admin/seekers.ts';
      export { evaluateAwards } from './functions/lib/awards.ts';
      export { onRequestGet as events } from './functions/api/public/events.ts';
      export { runReminders } from './worker/reminder.ts';
      export { eventClock } from './functions/lib/event-time.ts';
    ` },
    bundle: true, platform: 'node', format: 'esm', outfile,
    plugins: [{ name: 'no-real-email', setup(builder) {
      builder.onLoad({ filter: /functions\/lib\/email\.ts$/ }, () => ({
        loader: 'js', contents: `export async function sendBookingUpdate() {}
        export async function sendProgressUpdate() {}
        export async function sendViaResend(env, payload) { env.testSignInEmails.push(payload); }
        export async function sendSeekerConfirmation(env, payload) { if (env.failReminder) throw new Error('simulated mail failure'); env.reminders.push(payload); }
        export async function sendBothEmails(env) {
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
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-22T12:00:00Z') });
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
  const env = { DB: db, testEmailCalls: 0, testSignInEmails: [], reminders: [], SITE_URL: 'https://example.invalid',
    EMAIL_FROM: 'test@example.invalid', KEEPER_NOTIFY_EMAIL: 'test@example.invalid' };
  const call = async (handler, body, { route = '/', params = {}, method, cookie, origin = 'https://example.invalid' } = {}) => {
    const background = [];
    const response = await handler({
      env, params, data: { user: { email: 'keeper@example.invalid' } },
      request: new Request('https://example.invalid' + route, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? {Cookie:cookie} : {}) } }),
      }),
      waitUntil: p => background.push(p),
    });
    await Promise.all(background);
    return { status: response.status, cookie: response.headers.get('Set-Cookie'), data: await response.json() };
  };
  const count = async table => (await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
  const login = async (email = 'seeker@example.invalid') => {
    await call(app.lookup, {action:'request', email});
    const message = env.testSignInEmails.at(-1);
    const token = message.text.match(/sign-in=([0-9a-f-]+)/)[1];
    const response = await call(app.lookup, {action:'redeem', token});
    return response.cookie.split(';')[0];
  };
  const sessions = new Map();
  const lookup = async (email = 'seeker@example.invalid') => {
    if (!sessions.has(email)) sessions.set(email, await login(email));
    return call(app.lookup, {action:'session'}, {cookie:sessions.get(email)});
  };
  return { db, env, call, count, login, lookup };
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
  const found = await d.lookup();
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
  const lookup = await d.lookup();
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
  assert.equal((await d.call(app.intake, payload({ bookings: [slot('m_t2')] }))).status, 422, 'Tier II requires a later gathering');
  await d.db.prepare("UPDATE trial_events SET completed_on='2026-10-10' WHERE seeker_id=?").bind(id).run();
  assert.equal((await d.call(app.intake, payload({ bookings: [slot('m_t2')] }))).status, 201);
});

test('My Trials only exposes the matched seeker’s active bookings, without private fields', async t => {
  const d = await database(t);
  const id = await register(d, { bookings: [slot()] });
  await register(d, { name: 'Another seeker', email: 'another@example.invalid', bookings: [slot('m_t1_recitation', '10:00')] });
  await d.db.prepare("UPDATE bookings SET notes = 'private appointment note'").run();
  await d.db.prepare("UPDATE seekers SET notes = 'private Keeper note'").run();
  const lookup = () => d.lookup();
  const found = await lookup();
  assert.equal(found.data.seeker.bookings.length, 1);
  assert.equal(found.data.seeker.bookings[0].start_at, slot().start_at);
  assert.equal(found.data.seeker.bookings[0].past, false);
  assert.equal(found.data.seeker.time_zone, 'America/Chicago');
  assert.ok(!JSON.stringify(found.data).includes('private'));
  assert.equal(found.data.seeker.email,'seeker@example.invalid');
  assert.ok(!JSON.stringify(found.data).includes('another@example.invalid'));
  assert.equal(typeof found.data.seeker.bookings[0].id,'string');
  await d.db.prepare('UPDATE bookings SET voided_at = 1 WHERE seeker_id = ?').bind(id).run();
  assert.equal((await lookup()).data.seeker.bookings.length, 0);
  await register(d, { bookings: [slot('m_t1_recitation', '11:00')] });
  await d.db.prepare('UPDATE registrations SET voided_at = 1 WHERE seeker_id = ?').bind(id).run();
  assert.equal((await lookup()).data.seeker.bookings.length, 0);
  assert.deepEqual((await lookup()).data.seeker.registrations, []);
  for (const body of [{}, {name: 'Wrong', email: 'seeker@example.invalid'}, {name: 'Test Seeker', email: 'missing@example.invalid'}]) {
    assert.deepEqual((await d.call(app.lookup, body)).data, {ok: false});
  }
});

test('next tiers respect alternative trials, all-of requirements, voids and completion', async t => {
  const d = await database(t);
  const id = await register(d);
  const lookup = async () => (await d.lookup()).data.seeker;
  assert.deepEqual((await lookup()).next_tiers, {body:1, mind:1, soul:1});
  const first = await mark(d, id, 'm_t1_recitation');
  assert.equal((await lookup()).next_tiers.mind, 2);
  await mark(d, id, 'm_t2');
  await mark(d, id, 'm_t3');
  assert.equal((await lookup()).next_tiers.mind, null);
  await d.call(app.voidProgress, {}, {params:{id:first.trial_event_id}, method:'DELETE'});
  assert.equal((await lookup()).next_tiers.mind, 1);
  for (const code of ['s_t1','s_t2','s_t3_testament']) await mark(d, id, code);
  assert.equal((await lookup()).next_tiers.soul, 3);
  assert.equal((await lookup()).tier_progress.soul.find(tier => tier.tier === 3).complete, false);
});

test('past events disappear from registration but remain in personal history', async t => {
  const d = await database(t);
  const id = await register(d, {bookings:[slot()]});
  await d.db.prepare("UPDATE events SET starts_on = '2026-01-01', ends_on = '2026-01-02' WHERE id = 'gg_2026'").run();
  await d.db.prepare("UPDATE bookings SET start_at = '2026-01-01T09:00', end_at = '2026-01-01T09:30', buffer_until = '2026-01-01T09:45' WHERE seeker_id = ?").bind(id).run();
  const events = (await d.call(app.events)).data.events;
  assert.ok(!events.some(event => event.id === 'gg_2026'));
  assert.ok(events.some(event => event.id === 'october_expedition_2026'));
  const found = (await d.lookup()).data.seeker;
  assert.equal(found.registrations[0].past, true);
  assert.equal(found.bookings[0].past, true);
  const rejected = await d.call(app.intake, payload({email:'late@example.invalid'}));
  assert.equal(rejected.status, 422);
  assert.equal(rejected.data.error, 'event_ended');
  assert.equal(await d.count('seekers'), 1);
  assert.equal(d.env.testEmailCalls, 1);
});

test('ongoing and undated events remain available; inactive events are hidden', async t => {
  const d = await database(t);
  for (const [id, starts, ends, active] of [
    ['ongoing','2026-09-20','2026-09-22',1], ['today','2026-09-22',null,1],
    ['undated',null,null,1], ['inactive','2026-10-01','2026-10-02',0],
  ]) {
    await d.db.prepare("INSERT INTO events (id,name,kind,starts_on,ends_on,active) VALUES (?,?,'expedition',?,?,?)").bind(id,id,starts,ends,active).run();
  }
  const ids = (await d.call(app.events)).data.events.map(event => event.id);
  for (const id of ['ongoing','today','undated']) assert.ok(ids.includes(id));
  assert.ok(!ids.includes('inactive'));
});

test('event day boundaries use Central Time across daylight-saving changes', () => {
  assert.equal(app.eventClock('America/Chicago', new Date('2026-09-23T01:30:00Z')).date, '2026-09-22');
  assert.equal(app.eventClock('America/Chicago', new Date('2026-11-08T15:00:00Z')).localDateTime, '2026-11-08T09:00');
  assert.equal(app.eventClock('America/Chicago', new Date('2026-06-08T14:00:00Z')).localDateTime, '2026-06-08T09:00');
});

test('past appointment times cannot be booked and are removed from availability', async t => {
  const d = await database(t);
  t.mock.timers.setTime(new Date('2026-11-08T16:00:00Z').getTime()); // 10 AM at the gathering
  const rejected = await d.call(app.intake, payload({bookings:[slot()]}));
  assert.equal(rejected.status, 422);
  assert.equal(rejected.data.error, 'past_slot');
  assert.equal(await d.count('registrations'), 0);
  const availability = (await d.call(app.availability, undefined, {route:'/api/public/availability?event_id=gg_2026&trial_codes=m_t1_recitation'})).data;
  assert.ok(availability.trials.m_t1_recitation.available_starts.every(start => start >= '2026-11-08T10:00'));
});

test('email sign-in proves mailbox ownership, is single-use, and signs out server-side', async t => {
  const d = await database(t);
  await register(d);
  assert.equal((await d.call(app.lookup, {name:'Test Seeker',email:'seeker@example.invalid'})).status, 401);
  const requested = await d.call(app.lookup, {action:'request',email:'SEEKER@example.invalid'});
  assert.equal(requested.status, 202);
  const token = d.env.testSignInEmails[0].text.match(/sign-in=([0-9a-f-]+)/)[1];
  assert.ok(!(await d.db.prepare('SELECT token_hash FROM seeker_sign_ins').first()).token_hash.includes(token));
  const rejectedOrigin = await d.call(app.lookup, {action:'redeem',token}, {origin:'https://other.invalid'});
  assert.equal(rejectedOrigin.status, 403);
  const opened = await d.call(app.lookup, {action:'redeem',token});
  assert.equal(opened.data.seeker.name, 'Test Seeker');
  assert.match(opened.cookie, /Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await d.call(app.lookup, {action:'redeem',token})).status, 401);
  const cookie = opened.cookie.split(';')[0];
  assert.equal((await d.call(app.lookup,{action:'session'}, {cookie})).status, 200);
  await d.call(app.lookup, {action:'logout'}, {cookie});
  assert.equal((await d.call(app.lookup,{action:'session'}, {cookie})).status, 401);
});

test('expired links fail and unknown or rate-limited emails receive the same response', async t => {
  const d = await database(t);
  await register(d);
  const known = await d.call(app.lookup,{action:'request',email:'seeker@example.invalid'});
  const repeated = await d.call(app.lookup,{action:'request',email:'seeker@example.invalid'});
  const missing = await d.call(app.lookup,{action:'request',email:'missing@example.invalid'});
  assert.deepEqual(known.data, missing.data);
  assert.deepEqual(known.data, repeated.data);
  assert.equal(d.env.testSignInEmails.length, 1);
  const token = d.env.testSignInEmails[0].text.match(/sign-in=([0-9a-f-]+)/)[1];
  await d.db.prepare('UPDATE seeker_sign_ins SET expires_at = 1').run();
  assert.equal((await d.call(app.lookup,{action:'redeem',token})).status, 401);
});

test('reminders exclude void registrations and bookings, persist intentions, and never resend a sent reminder', async t => {
  const d = await database(t);
  const id = await register(d, {bookings:[slot()], trial_intentions:[{code:'b_t1',preferred_time:'10:00'}]});
  const canceled = await register(d, {email:'canceled@example.invalid'});
  await d.db.prepare('UPDATE registrations SET voided_at=1 WHERE seeker_id=?').bind(canceled).run();
  await register(d, {bookings:[slot('m_t1_recitation','10:00')]});
  await d.db.prepare("UPDATE registrations SET voided_at=1 WHERE id=(SELECT registration_id FROM bookings WHERE start_at LIKE '%T10:00')").run();
  t.mock.timers.tick(new Date('2026-11-07T12:00:00Z') - new Date('2026-09-22T12:00:00Z'));
  const first = await app.runReminders(d.env);
  assert.equal(first.sent,1);
  assert.equal(d.env.reminders[0].bookings.length,1);
  assert.equal(d.env.reminders[0].trial_intentions[0].code,'b_t1');
  assert.equal(d.env.reminders[0].reminder,true);
  assert.equal((await app.runReminders(d.env)).sent,0);
  assert.equal(d.env.reminders.length,1);
  assert.equal((await d.db.prepare('SELECT status FROM reminder_deliveries WHERE seeker_id=?').bind(id).first()).status,'sent');
});

test('failed reminders stay visible and may be retried without duplicating successful ones', async t => {
  const d = await database(t);
  await register(d);
  t.mock.timers.tick(new Date('2026-11-07T12:00:00Z') - new Date('2026-09-22T12:00:00Z'));
  d.env.failReminder = true;
  assert.equal((await app.runReminders(d.env)).failed,1);
  assert.equal((await d.db.prepare('SELECT status FROM reminder_deliveries').first()).status,'failed');
  d.env.failReminder = false;
  assert.equal((await app.runReminders(d.env)).sent,1);
  assert.equal(d.env.reminders.length,1);
  assert.equal((await d.db.prepare('SELECT attempts FROM reminder_deliveries').first()).attempts,2);
});


test('retrying the same plan returns the saved registration and sends mail only once', async t => {
  const d=await database(t);
  const body=payload({request_id:crypto.randomUUID(),bookings:[slot()]});
  const first=await d.call(app.intake,body);
  const retry=await d.call(app.intake,body);
  assert.equal(first.status,201);assert.equal(retry.status,200);
  assert.equal(first.data.registration_id,retry.data.registration_id);
  assert.equal(d.env.testEmailCalls,1);assert.equal(await d.count('bookings'),1);
});
test('planned trials enforce catalog, prerequisite and date checks',async t=>{
 const d=await database(t);
 for(const trial_intentions of [[{code:'invented'}],[{code:'m_t2'}],[{code:'m_t1_recitation'}],[{code:'b_t1',preferred_time:'2026-12-01T10:00'}]]) {
  assert.equal((await d.call(app.intake,payload({trial_intentions}))).status,422);
 }
});
test('booking management requires ownership and retains progress after cancellation',async t=>{
 const d=await database(t);const id=await register(d,{bookings:[slot()]});
 const cookie=await d.login();const b=await d.db.prepare('SELECT id FROM bookings WHERE seeker_id=?').bind(id).first();
 assert.equal((await d.call(app.booking,{action:'cancel',id:b.id})).status,401);
 await mark(d,id,'b_t1');
 const changed=await d.call(app.booking,{action:'reschedule',id:b.id,start_at:'2026-11-08T11:00'},{cookie});
 assert.equal(changed.status,200);
 const canceled=await d.call(app.booking,{action:'cancel',id:b.id},{cookie});assert.equal(canceled.status,200);
 const result=await d.call(app.lookup,{action:'session'},{cookie});assert.equal(result.data.seeker.bookings.length,0);
 assert.ok(result.data.seeker.requirements.find(r=>r.code==='b_t1').complete);
});

test('an appointment later in the gathering receives its own deduplicated reminder',async t=>{
 const d=await database(t);
 await register(d,{bookings:[{trial_code:'m_t1_recitation',start_at:'2026-11-10T10:00'}]});
 t.mock.timers.setTime(new Date('2026-11-09T12:00:00Z').getTime());
 const first=await app.runReminders(d.env);assert.equal(first.sent,1);
 assert.equal(d.env.reminders[0].appointment_reminder,true);
 const second=await app.runReminders(d.env);assert.equal(second.sent,0);
});

test('member profiles require faith approval, isolate owners, and expose only reviewed snapshots',async t=>{
 const d=await database(t);await register(d);const cookie=await d.login();
 assert.equal((await d.call(app.memberEditor,{action:'load'},{cookie})).status,403);
 assert.equal((await d.call(app.adminMember,{action:'grant',email:'seeker@example.invalid',name:'Aster'},{origin:'https://attacker.invalid'})).status,403);
 assert.equal((await d.call(app.adminMember,{action:'grant',email:'seeker@example.invalid',name:'Aster'})).status,200);
 assert.equal(await d.count('seekers'),1);
 const loaded=(await d.call(app.memberEditor,{action:'load'},{cookie})).data.member;
 const profile={...loaded.draft,introduction:'A wandering brewer.',story:'One\n\nTwo',hynafol_title:'Brewmaster of Hynafol'};
 assert.equal((await d.call(app.memberEditor,{action:'submit',revision:0,profile,consent:false},{cookie})).status,400);
 assert.equal((await d.call(app.memberEditor,{action:'submit',revision:0,profile,consent:true},{cookie})).status,200);
 assert.equal((await d.call(app.publicMembers)).data.members.length,0);
 assert.equal((await d.call(app.adminMember,{action:'approve',id:loaded.id,revision:0})).status,409);
 assert.equal((await d.call(app.adminMember,{action:'approve',id:loaded.id,revision:1,leadership:true})).status,200);
 const publicRow=(await d.call(app.publicMembers)).data.members[0];assert.equal(publicRow.name,'Aster');assert.equal(publicRow.leadership,true);assert.equal(publicRow.email,undefined);assert.equal(publicRow.seeker_id,undefined);
 await d.call(app.memberEditor,{action:'save',revision:1,profile:{...profile,name:'Private draft'}},{cookie});
 assert.equal((await d.call(app.publicMembers)).data.members[0].name,'Aster');
 assert.equal((await d.call(app.adminMember,{action:'approve',id:loaded.id,revision:2})).status,400);
 await register(d,{email:'other@example.invalid'});const other=await d.login('other@example.invalid');
 assert.equal((await d.call(app.memberEditor,{action:'load',id:loaded.id},{cookie:other})).status,403);
 assert.equal((await d.call(app.memberEditor,{action:'load'},{cookie,origin:'https://attacker.invalid'})).status,403);
 await d.call(app.memberEditor,{action:'withdraw'},{cookie});assert.equal((await d.call(app.publicMembers)).data.members.length,0);
 await d.call(app.adminMember,{action:'suspend',id:loaded.id,revision:2});assert.equal((await d.call(app.memberEditor,{action:'load'},{cookie})).status,403);
});
test('portraits reject non-JPEG, strip metadata and enforce dimensions',async()=>{
 const jpeg=(width=10)=>Uint8Array.from([255,216,255,225,0,7,71,80,83,33,33,255,192,0,11,8,0,10,width>>8,width&255,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,2,3,255,217,77,69,84,65]);
 const data=b=>'data:image/jpeg;base64,'+Buffer.from(b).toString('base64');
 const clean=Buffer.from(app.cleanPortrait(data(jpeg())),'base64');assert.ok(!clean.includes(Buffer.from('GPS')));assert.ok(!clean.includes(Buffer.from('META')));assert.equal(clean.at(-1),217);
 assert.throws(()=>app.cleanPortrait('data:image/svg+xml;base64,PHN2Zz4='));assert.throws(()=>app.cleanPortrait(data(jpeg(900))));assert.throws(()=>app.cleanPortrait(data([255,216,255])));
});

test('chronicles keep edits private, reject stale publishing, and can be hidden',async t=>{
 const d=await database(t);const entry={title:'The Beacon',date:'2026-02',summary:'A light.',body:'A light for the Circle.',author:'The Scribe',source:'https://hynafol.wiki.gg/wiki/Keepers_of_the_Current',video:''};
 assert.equal((await d.call(app.adminChronicle,{action:'save',entry},{origin:'https://evil.invalid'})).status,403);
 assert.equal((await d.call(app.adminChronicle,{action:'save',entry:{...entry,source:'javascript:alert(1)'}})).status,400);
 const saved=await d.call(app.adminChronicle,{action:'save',entry});assert.equal(saved.status,200);const id=saved.data.id;
 assert.equal((await d.call(app.publicChronicles)).data.entries.length,0);
 await d.call(app.adminChronicle,{action:'publish',id,revision:1});assert.equal((await d.call(app.publicChronicles)).data.entries[0].title,'The Beacon');
 await d.call(app.adminChronicle,{action:'save',id,revision:1,entry:{...entry,title:'Private revision'}});
 assert.equal((await d.call(app.publicChronicles)).data.entries[0].title,'The Beacon');
 assert.equal((await d.call(app.adminChronicle,{action:'publish',id,revision:1})).status,409);
 await d.call(app.adminChronicle,{action:'hide',id,revision:2});assert.equal((await d.call(app.publicChronicles)).data.entries.length,0);
});

 test('character sign-in email preserves the editor destination', async t => {
 const d = await database(t);
 await register(d);
 const result = await d.call(app.lookup,{action:'request',email:'seeker@example.invalid',next:'character'});
 assert.equal(result.status,202);
 const email = d.env.testSignInEmails[0];
 assert.equal(email.subject,'Sign in to My character');
 assert.match(email.text,/lookup\.html\?next=character#sign-in=/);
 assert.match(email.html,/Write your story/);
 });

test('admin registrations preserve selected trial names, booked times and delivery statuses', async t => {
 const d=await database(t);
 const id=await register(d,{bookings:[slot()],trial_intentions:[{code:'b_t1',preferred_time:'2026-11-08T10:00'}]});
 const result=await d.call(app.overview);
 assert.equal(result.status,200);
 const r=result.data.registrations.find(r=>r.seeker_id===id);
 assert.equal(r.choices[0].code,'b_t1');assert.ok(r.choices[0].name);
 assert.equal(r.choices[0].preferred_time,'2026-11-08T10:00');
 assert.equal(r.bookings[0].trial_code,'m_t1_recitation');
 assert.equal(r.seeker_email_status,'sent');
 assert.deepEqual(result.data.pending_profiles,[]);
 assert.equal((await d.call(app.overview)).data.registrations[0].id,r.id);
});

test('admin and seeker availability agree after calendar conflicts and booking buffers',async t=>{
 const d=await database(t);await register(d,{bookings:[slot()]});
 d.env.TALIA_CALENDAR_ICS_URL='https://calendar.google.com/calendar/ical/test/basic.ics';
 t.mock.method(globalThis,'fetch',async()=>new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:lunch\r\nDTSTART:20261108T180000Z\r\nDTEND:20261108T200000Z\r\nEND:VEVENT\r\nEND:VCALENDAR'));
 const route='/api/admin/availability?event_id=gg_2026&trial_codes=m_t1_recitation';
 const admin=await d.call(app.adminAvailability,undefined,{route});
 const publicView=await d.call(app.availability,undefined,{route});
 assert.equal(admin.status,200);assert.equal(admin.data.calendar_connected,true);assert.deepEqual(admin.data.trials,publicView.data.trials);
 const starts=admin.data.trials.m_t1_recitation.available_starts;assert.ok(starts.length);assert.ok(!starts.includes(slot().start_at));
 assert.ok(!starts.some(s=>s>='2026-11-08T12:00'&&s<'2026-11-08T14:00'));
 delete d.env.TALIA_CALENDAR_ICS_URL;assert.equal((await d.call(app.adminAvailability,undefined,{route})).status,503);
 d.env.TALIA_CALENDAR_ICS_URL='https://calendar.google.com/calendar/ical/test/basic.ics';t.mock.method(globalThis,'fetch',async()=>new Response('unavailable',{status:503}));
 const failed=await d.call(app.adminAvailability,undefined,{route});assert.equal(failed.status,503);assert.equal(failed.data.trials,undefined);
});

test('novel-length member stories survive submission, publication and later edits',async t=>{
 const d=await database(t);await register(d);const cookie=await d.login();
 await d.call(app.adminMember,{action:'grant',email:'seeker@example.invalid',name:'Aster'});
 const loaded=(await d.call(app.memberEditor,{action:'load'},{cookie})).data.member;
 const story=('## A chapter\nThe Current remembers.\n\n').repeat(15000).slice(0,500000);
 const profile={...loaded.draft,introduction:'A novel of the Current.',story};
 const submit=await d.call(app.memberEditor,{action:'submit',revision:0,profile,consent:true},{cookie});assert.equal(submit.status,200);
 assert.equal((await d.call(app.adminMember,{action:'approve',id:loaded.id,revision:1})).status,200);
 const read=()=>d.call(app.publicMembers,undefined,{route:'/api/public/members?id='+loaded.id});
 assert.equal((await read()).data.members[0].story,story);
 assert.equal((await d.call(app.memberEditor,{action:'save',revision:1,profile:{...profile,story:story+'x'}},{cookie})).status,400);
 assert.equal((await d.call(app.adminMember,{action:'save',id:loaded.id,revision:1,profile:{...profile,story:story.replace('A chapter','A Chapter')}})).status,200);
 assert.equal((await read()).data.members[0].story,story);
 assert.equal((await d.call(app.memberEditor,{action:'load'},{cookie})).data.member.draft.story.length,500000);
});
