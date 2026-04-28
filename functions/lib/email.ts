// Resend integration + the two transactional emails sent on intake.
// The seeker confirmation is in-fiction (dark + gold theme); the admin
// notification is terse and operational. Final copy reviewed by Dez in Phase 4.

import type { Env } from './db';
import { ringHumanList } from './validate';

interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  reply_to?: string;
}

interface SeekerEmailContext {
  name: string;
  email: string;
  house: string | null;
  rings_pursued: ('body' | 'mind' | 'soul')[];
  event_name: string;
  event_starts_on: string | null;
  event_ends_on: string | null;
  preferred_date: string | null;
  preferred_time: string | null;
  submitted_at_iso: string;
}

export async function sendBothEmails(env: Env, ctx: SeekerEmailContext): Promise<{
  seeker: 'sent' | 'failed';
  admin: 'sent' | 'failed';
}> {
  console.log('[email] env check', {
    hasResendKey: !!env.RESEND_API_KEY,
    resendKeyPrefix: env.RESEND_API_KEY ? env.RESEND_API_KEY.slice(0, 5) : '(none)',
    resendKeyLen: env.RESEND_API_KEY?.length ?? 0,
    keeperEmail: env.KEEPER_NOTIFY_EMAIL || '(unset)',
    emailFrom: env.EMAIL_FROM || '(unset)',
    siteUrl: env.SITE_URL || '(unset)',
  });
  const [seekerResult, adminResult] = await Promise.allSettled([
    sendSeekerConfirmation(env, ctx),
    sendAdminNotification(env, ctx),
  ]);
  if (seekerResult.status === 'rejected') {
    console.error('[email] seeker confirmation REJECTED:', String(seekerResult.reason), seekerResult.reason);
  } else {
    console.log('[email] seeker confirmation OK');
  }
  if (adminResult.status === 'rejected') {
    console.error('[email] admin notification REJECTED:', String(adminResult.reason), adminResult.reason);
  } else {
    console.log('[email] admin notification OK');
  }
  return {
    seeker: seekerResult.status === 'fulfilled' ? 'sent' : 'failed',
    admin: adminResult.status === 'fulfilled' ? 'sent' : 'failed',
  };
}

async function sendSeekerConfirmation(env: Env, c: SeekerEmailContext): Promise<void> {
  const ringsHuman = ringHumanList(c.rings_pursued);
  const eventDates = fmtEventDates(c.event_starts_on, c.event_ends_on);
  const houseLine = c.house ? ` of House ${escapeHtml(c.house)}` : '';
  const houseLineText = c.house ? ` of House ${c.house}` : '';
  const lookupUrl = `${env.SITE_URL}/lookup.html`;
  const trialsUrl = `${env.SITE_URL}/trials.html`;

  const subject = `The Current acknowledges you, ${c.name}`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0e0404;font-family:Georgia,'Times New Roman',serif;color:#f0dfc0;">
<div style="max-width:580px;margin:0 auto;background:rgba(42,14,14,0.7);border:1px solid rgba(200,150,62,0.25);border-radius:6px;padding:32px;">
  <h1 style="color:#C8963E;font-size:22px;margin:0 0 16px 0;letter-spacing:0.5px;">The Current acknowledges you</h1>
  <p style="line-height:1.6;margin:0 0 16px 0;">The Keeper has marked your name in the Trial Scroll.</p>

  <div style="border-top:1px solid rgba(200,150,62,0.25);border-bottom:1px solid rgba(200,150,62,0.25);padding:18px 0;margin:18px 0;">
    <p style="margin:0 0 8px 0;"><span style="color:#907050;">Recorded as:</span> <strong style="color:#E8B96A;">${escapeHtml(c.name)}</strong>${houseLine}</p>
    <p style="margin:0 0 8px 0;"><span style="color:#907050;">Pursuing:</span> ${escapeHtml(ringsHuman)}</p>
    <p style="margin:0;"><span style="color:#907050;">First gathering:</span> ${escapeHtml(c.event_name)} <span style="color:#907050;">— ${escapeHtml(eventDates)}</span></p>
  </div>

  <!-- ── WARNING BLOCK ── -->
  <div style="border:1px solid rgba(210,90,50,0.55);background:rgba(100,25,10,0.3);border-radius:4px;padding:15px 18px;margin:22px 0;">
    <p style="margin:0 0 8px 0;color:#e08060;font-size:11.5px;font-weight:bold;letter-spacing:0.7px;text-transform:uppercase;">Before you begin — read this</p>
    <p style="margin:0 0 10px 0;line-height:1.65;font-size:13.5px;">Each trial attempt is a commitment. If you do not complete a trial — for any reason — that attempt is spent. There are no restarts, no extensions, and no exceptions on the day. You must re-register and wait for a future event to try again.</p>
    <p style="margin:0;font-style:italic;color:#c8a080;font-size:13px;line-height:1.5;">Come ready. Take this seriously. The Current is patient — but the Scroll remembers.</p>
  </div>

  <!-- ── HOW IT WORKS ── -->
  <p style="line-height:1.6;margin:20px 0 10px 0;"><strong style="color:#E8B96A;">How the trials work:</strong></p>
  <ul style="line-height:1.75;margin:0 0 6px 0;padding-left:20px;font-size:13.5px;">
    <li>Arrive ready. The Keeper will find you and confirm your time.</li>
    <li>Tiers within each pillar are sequential — Tier I before Tier II, Tier II before Tier III. You may work across different pillars at the same event.</li>
    <li>The final tier of every pillar (Tier III) may only be attempted at the <strong>Grand Gathering</strong> — once per year.</li>
  </ul>
  <p style="margin:4px 0 20px 0;font-size:13px;"><a href="${escapeAttr(trialsUrl)}" style="color:#C8963E;">See the full trial descriptions →</a></p>

  <!-- ── TRIAL RULES FOR THEIR RINGS ── -->
  <p style="line-height:1.6;margin:0 0 8px 0;"><strong style="color:#E8B96A;">Your trials — what is required of you:</strong></p>
  ${trialRulesHtml(c.rings_pursued)}

  <!-- ── SIGN-OFF ── -->
  <p style="line-height:1.6;margin:20px 0 8px 0;font-size:13px;">Track your standing at any time: <a href="${escapeAttr(lookupUrl)}" style="color:#C8963E;">${escapeHtml(lookupUrl)}</a> — your name and this address are the key.</p>
  <p style="line-height:1.6;margin:28px 0 4px 0;font-style:italic;color:#E8B96A;text-align:center;">"When we move, we move as one."</p>
  <p style="text-align:center;margin:0;color:#907050;font-size:13px;">— Keepers of the Current</p>
</div>
</body></html>`;

  const text = `The Current acknowledges you, ${c.name}.

The Keeper has marked your name in the Trial Scroll.

  Recorded as: ${c.name}${houseLineText}
  Pursuing: ${ringsHuman}
  First gathering: ${c.event_name} — ${eventDates}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEFORE YOU BEGIN — READ THIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Each trial attempt is a commitment. If you do not complete a trial
— for any reason — that attempt is spent. There are no restarts,
no extensions, and no exceptions on the day. You must re-register
and wait for a future event to try again.

Come ready. Take this seriously. The Scroll remembers.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HOW THE TRIALS WORK:
  • Arrive ready. The Keeper will find you and confirm your time.
  • Tiers are sequential within each pillar — Tier I before Tier II,
    Tier II before Tier III. You may work across pillars at the same event.
  • The final tier of every pillar (Tier III) may only be attempted at
    the Grand Gathering — once per year.

Full trial details: ${trialsUrl}

YOUR TRIALS — WHAT IS REQUIRED OF YOU:
${trialRulesText(c.rings_pursued)}

Track your standing at any time: ${lookupUrl}
Your name and this email address are the key.

"When we move, we move as one."

— Keepers of the Current`;

  await sendViaResend(env, {
    from: env.EMAIL_FROM,
    to: [c.email],
    subject,
    html,
    text,
  });
}

async function sendAdminNotification(env: Env, c: SeekerEmailContext): Promise<void> {
  const houseLabel = c.house ? ` (${c.house})` : '';
  const subject = `New seeker: ${c.name}${houseLabel} — ${c.event_name}`;
  const adminUrl = `${env.SITE_URL}/admin.html`;
  const ringsCsv = c.rings_pursued.join(', ');

  const text = `A new seeker has entered the Trial.

Name:           ${c.name}
House:          ${c.house ?? '—'}
Email:          ${c.email}
Rings pursued:  ${ringsCsv}
Event:          ${c.event_name}
Preferred date: ${c.preferred_date ?? '—'}
Preferred time: ${c.preferred_time ?? '—'}
Submitted:      ${c.submitted_at_iso}

Open the panel: ${adminUrl}`;

  const html = `<pre style="font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;line-height:1.5;background:#0e0404;color:#f0dfc0;padding:20px;border:1px solid #C8963E;">${escapeHtml(text)}</pre>`;

  await sendViaResend(env, {
    from: env.EMAIL_FROM,
    to: [env.KEEPER_NOTIFY_EMAIL],
    subject,
    html,
    text,
    reply_to: c.email,
  });
}

async function sendViaResend(env: Env, payload: ResendPayload): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping send', { to: payload.to, subject: payload.subject });
    throw new Error('RESEND_API_KEY not configured');
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[email] Resend API error', res.status, body);
    throw new Error(`Resend ${res.status}`);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Human-readable event date range, e.g. "Nov 8–15, 2026" */
function fmtEventDates(starts: string | null, ends: string | null): string {
  if (!starts) return 'dates to be announced';
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [sy, sm, sd] = starts.split('-').map(Number);
  if (!ends || ends === starts) return `${M[sm - 1]} ${sd}, ${sy}`;
  const [ey, em, ed] = ends.split('-').map(Number);
  if (sm === em && sy === ey) return `${M[sm - 1]} ${sd}–${ed}, ${sy}`;
  return `${M[sm - 1]} ${sd} – ${M[em - 1]} ${ed}, ${ey}`;
}

const ROW = 'padding:9px 0;border-top:1px solid rgba(200,150,62,0.12);';
const TIER_LBL = 'color:#907050;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 2px 0;';
const TASK_LBL = 'color:#E8B96A;font-size:13px;font-weight:bold;margin:2px 0 4px 0;';
const RULE_DESC = 'color:#c8b08a;font-size:12.5px;line-height:1.6;margin:0;';
const PILLAR_HDR = 'font-size:12.5px;font-weight:bold;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;border-bottom:1px solid rgba(200,150,62,0.22);padding-bottom:6px;';

/** HTML trial-rules block for each ring being pursued */
function trialRulesHtml(rings: ('body' | 'mind' | 'soul')[]): string {
  const parts: string[] = [];

  if (rings.includes('body')) {
    parts.push(`<div style="margin:14px 0 18px 0;">
  <div style="${PILLAR_HDR}color:#b0aea6;">⬤ Ring of Endurance — Body · Earth</div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier I — Any event</p>
    <p style="${TASK_LBL}">The Fast + The Watch (both required)</p>
    <p style="${RULE_DESC}">Abstain from food (water OK; health needs respected) for a minimum of 4 hours at the event — window set with the Keeper in advance. Then stand unarmed guard at a sacred location or protecting a designated person for a minimum of 1 hour: no speech, no leaving your post without formal dismissal.</p>
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier II — Subsequent event after Tier I</p>
    <p style="${TASK_LBL}">The Unison Kata</p>
    <p style="${RULE_DESC}">Learn the nine-movement weapon kata privately from the Keeper. At a later event, perform it in perfect unison with two or more others who have also learned it. All begin together, move together, end together. Any weapon. The Keeper is judging synchrony — not skill.</p>
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier III — Grand Gathering only</p>
    <p style="${TASK_LBL}">The Burden + The Plank + The Foot Race (all three required)</p>
    <p style="${RULE_DESC}">Carry the holy relic from morning to the final bell of that day — never set it down or transfer it. Additionally: hold a plank position until failure (time recorded publicly on the leaderboard), and run 100 metres timed. All three must be completed before the closing ceremony.</p>
  </div>
</div>`);
  }

  if (rings.includes('mind')) {
    parts.push(`<div style="margin:14px 0 18px 0;">
  <div style="${PILLAR_HDR}color:#b0aea6;">◆ Ring of Focus — Mind · Wind</div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier I — Any event</p>
    <p style="${TASK_LBL}">The Dilemma or The Recitation (choose one)</p>
    <p style="${RULE_DESC}"><em>The Dilemma:</em> The Keeper presents a moral or philosophical question. You reason aloud, honestly, without research or consultation — following your thought wherever it leads. <em>The Recitation:</em> Memorise a passage of your own choosing and deliver it to the Keeper without reference. The Keeper judges whether your mind is genuinely at work, not whether your answer is correct.</p>
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier II — Subsequent event after Tier I</p>
    <p style="${TASK_LBL}">The Vow of Silence</p>
    <p style="${RULE_DESC}">Maintain complete silence for a minimum 3-hour window in the active spaces of the event — no speech, no whispers, no gesture-communication. A Bearer carries a sealed note on your behalf: <em>"I am in the Vow."</em> A Bearer witnesses and attests at the window's end.</p>
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier III — Grand Gathering only</p>
    <p style="${TASK_LBL}">The Telling</p>
    <p style="${RULE_DESC}">Organise and host a gathering of your own making with at least two people who are not current members of the faith. At the gathering, speak honestly and without script about three things: what the Current is and what you believe, why you joined this faith, and why you are doing these trials. Report back to the Keeper — not what was said, but what it cost you.</p>
  </div>
</div>`);
  }

  if (rings.includes('soul')) {
    parts.push(`<div style="margin:14px 0 18px 0;">
  <div style="${PILLAR_HDR}color:#C8963E;">✦ Ring of Connection — Soul · Water</div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier I — Any event</p>
    <p style="${TASK_LBL}">The Approach or The Gift (choose one)</p>
    <p style="${RULE_DESC}"><em>The Approach:</em> Initiate and sustain a meaningful conversation with a stranger — learn their name, house, and something true and personal about them. Return to the Keeper and introduce them. <em>The Gift:</em> Make something by hand and give it to a stranger you've never spoken to — no explanation, no expectation. Return to the Keeper and describe who they were and what it felt like to give without knowing what would be received.</p>
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier II — Subsequent event after Tier I</p>
    <p style="${TASK_LBL}">The Service</p>
    <p style="${RULE_DESC}">Assist in preparing or facilitating a ritual, gathering, or event task that belongs entirely to someone else — another faith's ceremony, a Court's event, a stranger's quest. Serve on their terms. Seek no recognition. The person you serve — not the Keeper — witnesses and attests.</p>
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier III — Grand Gathering only</p>
    <p style="${TASK_LBL}">The Tea Ceremony + The Gift of the Coin (both required)</p>
    <p style="${RULE_DESC}">Meet privately with the Keeper for tea. Give an honest accounting of what this trial has cost you and what it has changed. Then: bring someone to the faith through the quality of your own presence across this trial. Design and host a public ceremony and offer the Coin of the Keepers to your new member with your own hands and your own words. The new member must formally register with the Keeper before the coin passes.</p>
  </div>
</div>`);
  }

  return parts.join('');
}

/** Plain-text trial-rules block for each ring being pursued */
function trialRulesText(rings: ('body' | 'mind' | 'soul')[]): string {
  const parts: string[] = [];

  if (rings.includes('body')) {
    parts.push(`
RING OF ENDURANCE — Body · Earth

  Tier I (Any event): The Fast + The Watch [BOTH REQUIRED]
    Abstain from food (water OK; health needs respected) for 4+ hours — window
    set with the Keeper in advance. Then stand unarmed guard at a sacred location
    or protecting a designated person for 1+ hour: no speech, no leaving your post
    without formal dismissal.

  Tier II (Subsequent event): The Unison Kata
    Learn the nine-movement weapon kata privately from the Keeper. At a later event,
    perform it in perfect unison with two or more others who have also learned it.
    All begin, move, and end together. The Keeper judges synchrony — not skill.

  Tier III (Grand Gathering only): The Burden + The Plank + The Foot Race [ALL THREE]
    Carry the holy relic from morning to the final bell — never set it down or
    transfer it. Also: hold a plank until failure (time recorded publicly), and
    run 100 metres timed. All three before closing ceremony.`);
  }

  if (rings.includes('mind')) {
    parts.push(`
RING OF FOCUS — Mind · Wind

  Tier I (Any event): The Dilemma or The Recitation [CHOOSE ONE]
    The Dilemma: The Keeper presents a moral question — reason aloud, no research,
    no consultation. OR The Recitation: Memorise a passage of your choosing and
    deliver it to the Keeper without reference. The Keeper judges whether your mind
    is genuinely at work, not whether your answer is correct.

  Tier II (Subsequent event): The Vow of Silence
    Complete silence for 3+ hours in the active spaces of the event. A Bearer
    carries a sealed note: "I am in the Vow." A Bearer witnesses and attests.

  Tier III (Grand Gathering only): The Telling
    Host a real gathering with 2+ non-members. Speak honestly — without script —
    about what the Current is, why you joined, and why you're doing these trials.
    Report back to the Keeper: not what was said, but what it cost you.`);
  }

  if (rings.includes('soul')) {
    parts.push(`
RING OF CONNECTION — Soul · Water

  Tier I (Any event): The Approach or The Gift [CHOOSE ONE]
    The Approach: Initiate a meaningful conversation with a stranger — learn their
    name, house, and something true about them. Return and introduce them to the
    Keeper. OR The Gift: Make something by hand and give it to a stranger, no
    explanation, no expectation. Return and describe who they were and what it felt
    like to give without knowing what would be received.

  Tier II (Subsequent event): The Service
    Assist another faith's or Court's event — on their terms, without recognition.
    The person you serve witnesses and attests.

  Tier III (Grand Gathering only): Tea Ceremony + Gift of the Coin [BOTH REQUIRED]
    Meet privately with the Keeper for tea. Give an honest accounting of what the
    trial has cost and changed in you. Then: bring someone to the faith through
    your presence. Design and host a public ceremony; offer the Coin of the Keepers
    with your own hands and your own words. The new member must formally register
    before the coin passes.`);
  }

  return parts.join('\n');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
