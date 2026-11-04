import assert from 'node:assert/strict';
import {test, before, after} from 'node:test';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {build} from 'esbuild';
let app, dir;
before(async()=>{
  dir=await mkdtemp(path.join(tmpdir(),'keeper-mail-'));
  const outfile=path.join(dir,'email.mjs');
  await build({entryPoints:[fileURLToPath(new URL('../functions/lib/email.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile});
  app=await import(pathToFileURL(outfile));
});
after(async()=>rm(dir,{recursive:true,force:true}));
const env={RESEND_API_KEY:'test-only',EMAIL_FROM:'keeper@example.invalid',KEEPER_NOTIFY_EMAIL:'owner@example.invalid',SITE_URL:'https://example.invalid'};
const context={name:'Test <Seeker>',email:'player@example.invalid',house:null,rings_pursued:['body','mind','soul'],event_name:'Grand Gathering',event_starts_on:'2026-11-08',event_ends_on:'2026-11-15',preferred_date:null,preferred_time:null,submitted_at_iso:'2026-11-03T12:00:00Z',bookings:[{trial_code:'m_t1_recitation',start_at:'2026-11-09T16:00',end_at:'2026-11-09T16:15'}],trial_intentions:[{code:'b_t1',preferred_time:'10:00'}]};
test('player mail includes preparation, accurate rules, booked vs planned times, reply contact, and email sign-in',async t=>{
  const messages=[];
  t.mock.method(globalThis,'fetch',async (_url,options)=>{messages.push(JSON.parse(options.body));return Response.json({id:'fake'});});
  await app.sendBothEmails(env,context);
  const player=messages.find(m=>m.to[0]===context.email);
  assert.equal(player.reply_to,env.KEEPER_NOTIFY_EMAIL);
  assert.match(player.html,/Test &lt;Seeker&gt;/);
  for(const field of ['html','text']) {
    for(const phrase of ['Central Time','Keepers Rest','no time reserved','one-time sign-in link','unless spoken to','witness','records the result']) assert.ok(player[field].toLowerCase().includes(phrase.toLowerCase()),`${field}: ${phrase}`);
    assert.ok(!player[field].includes('no exceptions'));
    assert.ok(!player[field].includes('learn the nine-movement'));
  }
  assert.ok(!player.text.includes('teach it to two willing people'), 'unselected Tier II rules are omitted');
  assert.match(player.text,/Nov 9, 2026/);
  assert.match(player.text,/4 PM – 4:15 PM/);
});
test('reminder uses the same rules and sends an idempotency key; delivery failures are surfaced',async t=>{
  let payload, headers;
  t.mock.method(globalThis,'fetch',async (_url,options)=>{payload=JSON.parse(options.body);headers=options.headers;return Response.json({id:'fake'});});
  await app.sendSeekerConfirmation(env,{...context,reminder:true,idempotency_key:'reminder/test'});
  assert.match(payload.subject,/Tomorrow/);
  assert.equal(headers['Idempotency-Key'],'reminder/test');
  assert.match(payload.text,/unless spoken to/);
  globalThis.fetch=async()=>new Response('failed',{status:503});
  assert.deepEqual(await app.sendBothEmails(env,context),{seeker:'failed',admin:'failed'});
});

test('story review alert goes to Talia with escaped name and revision idempotency',async t=>{
 const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push(options);return Response.json({id:'fake'});});
 await app.sendMemberReviewNotification(env,{id:'member-123',name:'Kairos <Test>',revision:3,hasPublished:true});
 const message=JSON.parse(calls[0].body);assert.deepEqual(message.to,['talia.emberborn@gmail.com']);assert.match(message.html,/Kairos &lt;Test&gt;/);assert.match(message.text,/revised/);assert.match(message.text,/Revision 3/);assert.match(message.text,/admin.html#members/);assert.equal(calls[0].headers['Idempotency-Key'],'member-review-member-123-3');
});
