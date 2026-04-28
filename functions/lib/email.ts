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
  bookings?: { trial_code: string; start_at: string; end_at: string }[];
  // Notification-only trials the seeker flagged (no slot needed — just a heads-up).
  trial_intentions?: string[];
}

export async function sendBothEmails(env: Env, ctx: SeekerEmailContext): Promise<{
  seeker: 'sent' | 'failed';
  admin: 'sent' | 'failed';
}> {
  const [seekerResult, adminResult] = await Promise.allSettled([
    sendSeekerConfirmation(env, ctx),
    sendAdminNotification(env, ctx),
  ]);
  // Only log on rejection — happy-path stays silent.
  if (seekerResult.status === 'rejected') {
    console.error('[email] seeker confirmation REJECTED:', String(seekerResult.reason));
  }
  if (adminResult.status === 'rejected') {
    console.error('[email] admin notification REJECTED:', String(adminResult.reason));
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

  <!-- ── BOOKED TIMES ── -->
  ${c.bookings && c.bookings.length > 0 ? `
  <div style="margin:16px 0;padding:14px 16px;background:rgba(200,150,62,0.07);border:1px solid rgba(200,150,62,0.22);border-radius:4px;">
    <p style="margin:0 0 10px 0;color:#E8B96A;font-size:13px;font-weight:bold;letter-spacing:0.2px;">Your booked trial times:</p>
    ${c.bookings.map((b) => `<div style="padding:3px 0;font-size:13px;color:#c8b08a;">${escapeHtml(fmtBookingSlot(b.trial_code, b.start_at, b.end_at))}</div>`).join('')}
    <p style="margin:10px 0 0 0;font-size:12px;color:#907050;font-style:italic;">If you need to change a time, speak with the Keeper before the event.</p>
  </div>` : c.preferred_date ? `
  <div style="margin:16px 0;padding:12px 16px;background:rgba(200,150,62,0.05);border:1px solid rgba(200,150,62,0.15);border-radius:4px;">
    <p style="margin:0;font-size:13px;color:#c8b08a;">Preferred session: <strong style="color:#E8B96A;">${escapeHtml(c.preferred_date)}${c.preferred_time ? ` at ${escapeHtml(c.preferred_time)}` : ''}</strong>. The Keeper will confirm your time when you arrive at the event.</p>
  </div>` : ''}

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

${c.bookings && c.bookings.length > 0 ? `Your booked trial times:
${c.bookings.map((b) => `  • ${fmtBookingSlot(b.trial_code, b.start_at, b.end_at)}`).join('\n')}
If you need to change a time, speak with the Keeper before the event.

` : c.preferred_date ? `Preferred session: ${c.preferred_date}${c.preferred_time ? ` at ${c.preferred_time}` : ''}
The Keeper will confirm your time when you arrive.

` : ''}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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

  const bookingsText = c.bookings && c.bookings.length > 0
    ? c.bookings.map((b) => `  • ${TRIAL_DISPLAY_NAMES[b.trial_code] ?? b.trial_code} — ${b.start_at}`).join('\n')
    : '  (none booked)';

  const intentionsText = c.trial_intentions && c.trial_intentions.length > 0
    ? c.trial_intentions.map((code) => `  • ${TRIAL_DISPLAY_NAMES[code] ?? code}`).join('\n')
    : '  (none flagged)';

  const text = `A new seeker has entered the Trial.

Name:           ${c.name}
House:          ${c.house ?? '—'}
Email:          ${c.email}
Rings pursued:  ${ringsCsv}
Event:          ${c.event_name}
Submitted:      ${c.submitted_at_iso}

BOOKED TRIAL SLOTS (need your calendar):
${bookingsText}

TRIALS THEY PLAN TO ATTEMPT (no slot — they'll find you):
${intentionsText}

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

/** Map trial catalog codes → human-readable names for email display */
const TRIAL_DISPLAY_NAMES: Record<string, string> = {
  'b_t1':                    'Body I — Awakening of Flesh (The Fast + The Watch)',
  'b_t2':                    'Body II — The Unison',
  'b_t3_burden':             'Body III — The Burden',
  'b_t3_plank':              'Body III — The Plank',
  'b_t3_foot_race':          'Body III — The Foot Race',
  'b_t3_course':             'Body III — The Course',
  'm_t1_dilemma':            'Mind I — The Dilemma',
  'm_t1_recitation':         'Mind I — The Recitation',
  'm_t2':                    'Mind II — Vow of Silence',
  'm_t3':                    'Mind III — The Telling',
  's_t1':                    'Soul I — Awakening of Connection',
  's_t1_approach':           'Soul I — The Approach',
  's_t1_gift':               'Soul I — The Gift',
  's_t2':                    'Soul II — The Service',
  's_t3_testament':          'Soul III — The Tea Ceremony',
  's_t3_final_introduction': 'Soul III — Gift of the Coin',
};

/** "Body II — The Form (The Unison Kata) · Nov 8 · 2:00–2:30 PM" */
function fmtBookingSlot(trialCode: string, startAt: string, endAt: string): string {
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtTime = (iso: string) => {
    const [, t] = iso.split('T');
    const [hh, mm] = t.split(':').map(Number);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const h = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    return mm === 0 ? `${h} ${ampm}` : `${h}:${String(mm).padStart(2, '0')} ${ampm}`;
  };
  const [datePart] = startAt.split('T');
  const [, sm, sd] = datePart.split('-').map(Number);
  const dow = new Date(`${datePart}T12:00:00Z`).getUTCDay();
  const name = TRIAL_DISPLAY_NAMES[trialCode] ?? trialCode;
  const endAmPm = endAt ? ` – ${fmtTime(endAt)}` : '';
  return `${name} · ${DAYS[dow]}, ${M[sm - 1]} ${sd} · ${fmtTime(startAt)}${endAmPm}`;
}

const ROW = 'padding:9px 0;border-top:1px solid rgba(200,150,62,0.12);';
const TIER_LBL = 'color:#907050;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 2px 0;';
const TASK_LBL = 'color:#E8B96A;font-size:13px;font-weight:bold;margin:2px 0 4px 0;';
const RULE_DESC = 'color:#c8b08a;font-size:12.5px;line-height:1.6;margin:0 0 8px 0;';
const PILLAR_HDR = 'font-size:12.5px;font-weight:bold;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;border-bottom:1px solid rgba(200,150,62,0.22);padding-bottom:6px;';
const COUNSEL_WRAP = 'margin:8px 0 0 0;padding:9px 12px;background:rgba(200,150,62,0.05);border-left:2px solid rgba(200,150,62,0.3);border-radius:0 3px 3px 0;';
const COUNSEL_HDR = 'color:#907050;font-size:10.5px;text-transform:uppercase;letter-spacing:0.5px;margin:0 0 4px 0;font-style:normal;';
const COUNSEL_TXT = 'color:#c8a880;font-size:12px;line-height:1.65;margin:0;';

function tip(items: string[]): string {
  return `<div style="${COUNSEL_WRAP}">
    <p style="${COUNSEL_HDR}">Keeper's Counsel</p>
    <p style="${COUNSEL_TXT}">${items.map(escapeHtml).join('<br><br>')}</p>
  </div>`;
}

/** HTML trial-rules block for each ring being pursued, with per-tier Keeper's Counsel tips */
function trialRulesHtml(rings: ('body' | 'mind' | 'soul')[]): string {
  const parts: string[] = [];

  if (rings.includes('body')) {
    parts.push(`<div style="margin:14px 0 18px 0;">
  <div style="${PILLAR_HDR}color:#b0aea6;">⬤ Ring of Endurance — Body · Earth</div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier I — Any event</p>
    <p style="${TASK_LBL}">The Fast + The Watch (both required)</p>
    <p style="${RULE_DESC}">Abstain from food (water OK; health needs respected) for a minimum of 4 hours at the event — window set with the Keeper in advance. Then stand unarmed guard at a sacred location or protecting a designated person for a minimum of 1 hour: no speech, no leaving your post without formal dismissal.</p>
    ${tip([
      'Eat a solid meal the evening before and morning of the event. Set your Fast window for mid-morning when hunger is still manageable, not when it has already peaked.',
      'Speak to the Keeper before your Fast begins — she cannot witness what she does not know is happening.',
      'For the Watch: choose your post location thoughtfully. Stand and hold through boredom, distraction, and anyone who tries to draw you away. The Keeper may or may not be watching. Hold as if she is.',
    ])}
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier II — Subsequent event after Tier I</p>
    <p style="${TASK_LBL}">The Form (The Unison Kata)</p>
    <p style="${RULE_DESC}">Learn the nine-movement weapon kata privately from the Keeper. At a later event, perform it in perfect unison with two or more others who have also learned it. All begin together, move together, end together. Any weapon. The Keeper is judging synchrony — not skill.</p>
    ${tip([
      'The Keeper teaches you privately. Do not try to learn the Form from website descriptions — you need the session with her. Book that teaching time in advance.',
      'When you know it cold on your own, find your partners and practice together before the event. The Form cannot be sight-read in front of the Keeper.',
      'Find your group early — you need at least two others who have passed Tier I. Arrange everything before the event, not on the day.',
    ])}
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier III — Grand Gathering only</p>
    <p style="${TASK_LBL}">The Burden + The Plank + The Foot Race (all three required)</p>
    <p style="${RULE_DESC}">Carry the holy relic from morning to the final bell of that day — never set it down or transfer it. Additionally: hold a plank position until failure (time recorded publicly on the leaderboard), and run 100 metres timed. All three must be completed before the closing ceremony.</p>
    ${tip([
      'The day of the Burden is longer than you expect. Dress for a full day. Plan every obligation — meals, other trials, social commitments — around never setting the relic down.',
      'The Plank and the Foot Race can be completed any day of the Grand Gathering. Do not leave them to the final day.',
      'For the Foot Race: 100 metres is a sprint. Give it fully.',
    ])}
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
    ${tip([
      'The Dilemma: the question has no clean answer. The Keeper is not looking for the right conclusion — she is watching whether your mind engages honestly with difficulty. Think aloud. Follow your reasoning even when it contradicts itself. Do not prepare answers in advance.',
      'The Recitation: choose something that genuinely matters to you. The Keeper notices what you chose to memorise as much as how you deliver it. Memorise it until it lives in your body — the nerves of the moment are pressure enough without also fighting for the words.',
    ])}
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier II — Subsequent event after Tier I</p>
    <p style="${TASK_LBL}">The Vow of Silence</p>
    <p style="${RULE_DESC}">Maintain complete silence for a minimum 3-hour window in the active spaces of the event — no speech, no whispers, no gesture-communication. A Bearer carries a sealed note on your behalf: "I am in the Vow." A Bearer witnesses and attests at the window's end.</p>
    ${tip([
      'Tell people who matter to you before the window begins — they can carry context for you and prevent situations that force you to choose.',
      'A Bearer is a member of the faith who holds at least one Ring. Before your Vow begins, ask a Bearer to serve as your witness — they carry your sealed note and speak on your behalf when you are directly confronted. If no Bearer is present at the event, the Keeper herself witnesses.',
      'The hardest moments are the small ones: when someone asks a direct question and breaking would seem harmless, even kind. That is the exact moment the trial is being held. Hold.',
    ])}
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier III — Grand Gathering only</p>
    <p style="${TASK_LBL}">The Telling</p>
    <p style="${RULE_DESC}">Organise and host a gathering of your own making with at least two people who are not current members of the faith. Speak honestly and without script about what the Current is and what you believe, why you joined, and why you are doing these trials. Report back to the Keeper — not what was said, but what it cost you.</p>
    ${tip([
      'The two non-members do not have to be strangers to you — friends outside the faith count. The gathering does not need to be formal. It needs to be real.',
      'Speak without a script. The Keeper is not asking you to recruit or to perform — she is asking you to tell the truth about something that matters to you, out loud, to people who do not already share it.',
      'When you report back: do not recap what was said. Tell her what it cost you. That is the whole of what she is listening for.',
    ])}
  </div>
</div>`);
  }

  if (rings.includes('soul')) {
    parts.push(`<div style="margin:14px 0 18px 0;">
  <div style="${PILLAR_HDR}color:#C8963E;">✦ Ring of Connection — Soul · Water</div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier I — Any event</p>
    <p style="${TASK_LBL}">The Approach or The Gift (choose one)</p>
    <p style="${RULE_DESC}"><em>The Approach:</em> Initiate and sustain a meaningful conversation with a stranger — learn their name, house, and something true and personal about them. Return to the Keeper and introduce them. <em>The Gift:</em> Make something by hand and give it to a stranger you have never spoken to — no explanation, no expectation. Return to the Keeper and describe who they were and what it felt like to give without knowing what would be received.</p>
    ${tip([
      'The Approach: look for someone at the edge of a group, or alone. Move first. Do not wait. Let the conversation arrive at something personal — if you rush it, the stranger will feel it.',
      'The Gift: make it before the event. The sincerity of something handmade matters more than its quality. Choose the stranger because something about them calls for it. Give it and let it go — do not explain the trial.',
      'When you return to the Keeper: introduce the stranger or describe the stranger as a person, not as a completed task.',
    ])}
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier II — Subsequent event after Tier I</p>
    <p style="${TASK_LBL}">The Service</p>
    <p style="${RULE_DESC}">Assist in preparing or facilitating a ritual, gathering, or event task that belongs entirely to someone else — another faith's ceremony, a Court's event, a stranger's quest. Serve on their terms. Seek no recognition. The person you serve — not the Keeper — witnesses and attests.</p>
    ${tip([
      'Ask around early in the event — rituals, courts, individual quests that need help. Do not wait until mid-event when everything is already underway.',
      'When you have found your place: subordinate fully. Their vision. Their terms. Your job is to be useful, not to contribute your perspective.',
      'Secure the attestation from the person you served before they leave the event. The Keeper needs their word, not yours.',
    ])}
  </div>
  <div style="${ROW}">
    <p style="${TIER_LBL}">Tier III — Grand Gathering only</p>
    <p style="${TASK_LBL}">The Tea Ceremony + The Gift of the Coin (both required)</p>
    <p style="${RULE_DESC}">Meet privately with the Keeper for tea. Give an honest accounting of what this trial has cost you and what it has changed. Then: bring someone to the faith through the quality of your own presence across this trial. Design and host a public ceremony and offer the Coin of the Keepers to your new member with your own hands and your own words. The new member must formally register with the Keeper before the coin passes.</p>
    ${tip([
      'The Tea Ceremony is a real conversation between two people who have traveled some of the same road. Come ready to speak honestly, not to perform honesty. The Keeper will wait in silence for the real thing to arrive.',
      'The new member MUST formally register with the Keeper before the ceremony — the coin cannot pass until that step is confirmed. Do not plan or announce the ceremony until registration is done.',
      'The ceremony is yours to design — simple or elaborate, as long as it is public and real. Think about who this person is and let that shape it.',
    ])}
  </div>
</div>`);
  }

  return parts.join('');
}

/** Plain-text trial-rules block for each ring being pursued, with per-tier tips */
function trialRulesText(rings: ('body' | 'mind' | 'soul')[]): string {
  const parts: string[] = [];

  if (rings.includes('body')) {
    parts.push(`
RING OF ENDURANCE — Body · Earth
──────────────────────────────────────────

  Tier I (Any event): The Fast + The Watch [BOTH REQUIRED]
    Abstain from food (water OK; health needs respected) for 4+ hours — window
    set with the Keeper in advance. Then stand unarmed guard at a sacred location
    or protecting someone for 1+ hour: no speech, no leaving your post without
    formal dismissal.

    Keeper's Counsel:
    → Eat a solid meal the evening before. Set your Fast window for mid-morning
      when hunger is still manageable. Tell the Keeper before your Fast begins.
    → For the Watch: choose your post thoughtfully. Hold through boredom,
      distraction, and anyone who tries to draw you away. The Keeper may not be
      watching. Hold as if she is.

  Tier II (Subsequent event): The Form (The Unison Kata)
    Learn the nine-movement weapon kata privately from the Keeper. At a later
    event, perform it in perfect unison with two or more others who have also
    learned it. All begin, move, and end together. The Keeper judges synchrony.

    Keeper's Counsel:
    → The Keeper teaches you privately — book that session, do not try to learn
      this from the website alone.
    → When you know it cold on your own, find your partners and practice together
      before the event. The Form cannot be sight-read in front of the Keeper.
    → Find your group early. You need at least two others who have passed Tier I.

  Tier III (Grand Gathering only): The Burden + The Plank + The Foot Race [ALL THREE]
    Carry the holy relic from morning to the final bell — never set it down or
    transfer it. Also: hold a plank until failure (time recorded publicly), and
    run 100 metres timed. All three before closing ceremony.

    Keeper's Counsel:
    → The Burden spans a full day. Plan every obligation around never setting it
      down — meals, other trials, social commitments.
    → The Plank and Foot Race can be done any day of the Gathering. Do not leave
      them to the last day.`);
  }

  if (rings.includes('mind')) {
    parts.push(`
RING OF FOCUS — Mind · Wind
──────────────────────────────────────────

  Tier I (Any event): The Dilemma or The Recitation [CHOOSE ONE]
    The Dilemma: The Keeper presents a moral question — reason aloud, no research,
    no consultation. OR The Recitation: Memorise a passage of your choosing and
    deliver it to the Keeper without reference.

    Keeper's Counsel:
    → The Dilemma has no correct answer. The Keeper is watching whether your mind
      engages honestly with difficulty — not whether you reach the right conclusion.
      Do not prepare in advance. Come as you are.
    → The Recitation: choose something that genuinely matters to you. The Keeper
      notices what you chose to memorise. Memorise it until it lives in your body.

  Tier II (Subsequent event): The Vow of Silence
    Complete silence for 3+ hours in the active spaces of the event. A Bearer
    carries a sealed note: "I am in the Vow." A Bearer witnesses and attests.

    Keeper's Counsel:
    → Tell people who matter to you before the window begins.
    → A Bearer is a member of the faith who holds at least one Ring. Ask one to
      serve as your witness — they carry your sealed note and speak on your behalf
      when you are directly confronted. If no Bearer is present at the event, the
      Keeper herself witnesses.
    → The hardest moments are the small ones: when breaking would seem harmless.
      That is the exact moment the trial is being held. Hold.

  Tier III (Grand Gathering only): The Telling
    Host a real gathering with 2+ non-members. Speak honestly — without script —
    about what the Current is, why you joined, and why you're doing these trials.
    Report back to the Keeper: not what was said, but what it cost you.

    Keeper's Counsel:
    → The non-members do not have to be strangers. The gathering does not need
      to be formal. It needs to be real.
    → Speak without a script. You are not recruiting — you are telling the truth
      about something that matters to you, out loud, to people who do not share it.
    → When you report back: tell her what it cost you, not what was said.`);
  }

  if (rings.includes('soul')) {
    parts.push(`
RING OF CONNECTION — Soul · Water
──────────────────────────────────────────

  Tier I (Any event): The Approach or The Gift [CHOOSE ONE]
    The Approach: Initiate a meaningful conversation with a stranger — learn their
    name, house, and something true about them. Return and introduce them to the
    Keeper. OR The Gift: Make something by hand and give it to a stranger, no
    explanation, no expectation. Return and describe who they were.

    Keeper's Counsel:
    → The Approach: move first. Do not wait for an invitation. Let the conversation
      arrive at something personal — if you rush it, the stranger will feel it.
    → The Gift: make it before the event. Sincerity matters more than quality.
      Choose the stranger because something about them calls for it.
    → Return to the Keeper and introduce the stranger as a person, not a task.

  Tier II (Subsequent event): The Service
    Assist another faith's or Court's event on their terms, without recognition.
    The person you serve witnesses and attests.

    Keeper's Counsel:
    → Ask around early — rituals, courts, individual quests that need help.
    → Subordinate fully. Their vision. Their terms. You are there to be useful,
      not to contribute your perspective.
    → Secure the attestation from the person you served before they leave.

  Tier III (Grand Gathering only): Tea Ceremony + Gift of the Coin [BOTH REQUIRED]
    Meet privately with the Keeper for tea and give an honest accounting of what
    this trial has cost and changed in you. Then bring someone to the faith through
    your presence — design and host a public ceremony and offer the Coin of the
    Keepers with your own hands. The new member must formally register before the
    coin passes.

    Keeper's Counsel:
    → Come ready to speak honestly, not to perform honesty. The Keeper will wait
      in silence for the real thing. Do not fill the space with polished answers.
    → THE NEW MEMBER MUST REGISTER BEFORE THE CEREMONY. Do not plan or announce
      the ceremony until that step is confirmed. The coin cannot pass until done.
    → The ceremony is yours to design. Let who this person is shape it.`);
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
