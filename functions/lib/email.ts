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

export interface SeekerEmailContext {
  reminder?: boolean;
  idempotency_key?: string;
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
  // Notification-only trials the seeker flagged. preferred_time is their preference
  // but does NOT block the calendar — no slot is reserved.
  trial_intentions?: { code: string; preferred_time?: string | null }[];
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

export async function sendSeekerConfirmation(env: Env, c: SeekerEmailContext): Promise<void> {
  const ringsHuman = ringHumanList(c.rings_pursued);
  const eventDates = fmtEventDates(c.event_starts_on, c.event_ends_on);
  const houseLine = c.house ? ` of House ${escapeHtml(c.house)}` : '';
  const houseLineText = c.house ? ` of House ${c.house}` : '';
  const lookupUrl = `${env.SITE_URL}/lookup.html`;
  const trialsUrl = `${env.SITE_URL}/trials.html`;

  const title = c.reminder ? 'Your gathering begins tomorrow' : 'The Current acknowledges you';
  const introduction = c.reminder ? 'Review your arrangements and prepare before you arrive.' : 'The Keeper has marked your name in the Trial Scroll.';
  const subject = c.reminder ? `Tomorrow — ${c.event_name} — your trial preparations` : `The Current acknowledges you, ${c.name}`;
  const preparation = [
    'Your registration records your interest. Only the times listed as booked are reserved; preferences and trial intentions are not appointments.',
    'All appointment times are Central Time (America/Chicago). Check in with the Keeper at Keepers Rest and confirm the exact meeting place before your trial.',
    'Before starting, agree on any required time window and witness with the Keeper. Tell the Keeper about access or health needs; the trial page explicitly respects health needs.',
    'After your attempt, report back and arrange any required witness attestation. Progress changes when the Keeper records the result, not automatically when a booked time ends.',
    `For questions, a missing result, or a time change, reply to this email or contact ${env.KEEPER_NOTIFY_EMAIL}.`,
    'Marking Interested in a Discord event does not reserve a trial appointment.',
  ];
  const intentions = (c.trial_intentions ?? []).map(i => `${TRIAL_DISPLAY_NAMES[i.code] ?? i.code}${i.preferred_time ? ` — preferred time: ${i.preferred_time}` : ''}`);
  const practicalHtml = `<h2 style="color:#E8B96A;font-size:18px;">What to do next</h2><ul style="line-height:1.7;">${preparation.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>${intentions.length ? `<p><strong>Planned trials — no time reserved:</strong></p><ul>${intentions.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>` : ''}`;
  const practicalText = `WHAT TO DO NEXT:\n${preparation.map(p => `• ${p}`).join('\n')}\n${intentions.length ? `\nPLANNED TRIALS — NO TIME RESERVED:\n${intentions.join('\n')}` : ''}`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0e0404;font-family:Georgia,'Times New Roman',serif;color:#f0dfc0;">
<div style="max-width:580px;margin:0 auto;background:rgba(42,14,14,0.7);border:1px solid rgba(200,150,62,0.25);border-radius:6px;padding:32px;">
  <h1 style="color:#C8963E;font-size:22px;margin:0 0 16px 0;letter-spacing:0.5px;">${title}</h1>
  <p style="line-height:1.6;margin:0 0 16px 0;">${introduction}</p>

  <div style="border-top:1px solid rgba(200,150,62,0.25);border-bottom:1px solid rgba(200,150,62,0.25);padding:18px 0;margin:18px 0;">
    <p style="margin:0 0 8px 0;"><span style="color:#907050;">Recorded as:</span> <strong style="color:#E8B96A;">${escapeHtml(c.name)}</strong>${houseLine}</p>
    <p style="margin:0 0 8px 0;"><span style="color:#907050;">Pursuing:</span> ${escapeHtml(ringsHuman)}</p>
    <p style="margin:0;"><span style="color:#907050;">Registered gathering:</span> ${escapeHtml(c.event_name)} <span style="color:#907050;">— ${escapeHtml(eventDates)}</span></p>
  </div>

  <!-- ── BOOKED TIMES ── -->
  ${c.bookings && c.bookings.length > 0 ? `
  <div style="margin:16px 0;padding:14px 16px;background:rgba(200,150,62,0.07);border:1px solid rgba(200,150,62,0.22);border-radius:4px;">
    <p style="margin:0 0 10px 0;color:#E8B96A;font-size:13px;font-weight:bold;letter-spacing:0.2px;">Your booked trial times:</p>
    ${c.bookings.map((b) => `<div style="padding:3px 0;font-size:13px;color:#c8b08a;">${escapeHtml(fmtBookingSlot(b.trial_code, b.start_at, b.end_at))}</div>`).join('')}
    <p style="margin:10px 0 0 0;font-size:12px;color:#907050;font-style:italic;">If you need to change a time, speak with the Keeper before the event.</p>
  </div>` : c.preferred_date ? `
  <div style="margin:16px 0;padding:12px 16px;background:rgba(200,150,62,0.05);border:1px solid rgba(200,150,62,0.15);border-radius:4px;">
    <p style="margin:0;font-size:13px;color:#c8b08a;">Preferred session: <strong style="color:#E8B96A;">${escapeHtml(c.preferred_date)}${c.preferred_time ? ` at ${escapeHtml(c.preferred_time)}` : ''}</strong>. This is a preference, not a reserved appointment. Contact the Keeper to agree a time.</p>
  </div>` : ''}

  ${practicalHtml}

  <!-- ── WARNING BLOCK ── -->
  <div style="border:1px solid rgba(210,90,50,0.55);background:rgba(100,25,10,0.3);border-radius:4px;padding:15px 18px;margin:22px 0;">
    <p style="margin:0 0 8px 0;color:#e08060;font-size:11.5px;font-weight:bold;letter-spacing:0.7px;text-transform:uppercase;">Before you begin — read this</p>
    <p style="margin:0 0 10px 0;line-height:1.65;font-size:13.5px;">Read the requirements for your chosen tier before you begin. Required parts and witness attestations must be completed for the Keeper to record a pass. If an attempt is incomplete, ask the Keeper about your next eligible attempt. Health needs are respected.</p>
    <p style="margin:0;font-style:italic;color:#c8a080;font-size:13px;line-height:1.5;">Come ready. Take this seriously. The Current is patient — but the Scroll remembers.</p>
  </div>

  <!-- ── HOW IT WORKS ── -->
  <p style="line-height:1.6;margin:20px 0 10px 0;"><strong style="color:#E8B96A;">How the trials work:</strong></p>
  <ul style="line-height:1.75;margin:0 0 6px 0;padding-left:20px;font-size:13.5px;">
    <li>Check in with the Keeper at Keepers Rest before starting. Confirm the meeting place, timing, and witness arrangements; do not assume the Keeper will find you.</li>
    <li>Tier I is open to all Hynafol members. Tiers within each pillar are sequential — Tier I before Tier II, Tier II before Tier III. Tier II is attempted at a subsequent event after Tier I. You may work across different pillars at the same event.</li>
    <li>The final tier of every pillar (Tier III) may only be attempted at the <strong>Grand Gathering</strong> — once per year.</li>
  </ul>
  <p style="margin:4px 0 20px 0;font-size:13px;"><a href="${escapeAttr(trialsUrl)}" style="color:#C8963E;">See the full trial descriptions →</a></p>

  <!-- ── TRIAL RULES FOR THEIR RINGS ── -->
  <p style="line-height:1.6;margin:0 0 8px 0;"><strong style="color:#E8B96A;">Your trials — what is required of you:</strong></p>
  ${trialRulesHtml(c.rings_pursued)}

  <!-- ── SIGN-OFF ── -->
  <p style="line-height:1.6;margin:20px 0 8px 0;font-size:13px;">Track your standing at any time: <a href="${escapeAttr(lookupUrl)}" style="color:#C8963E;">${escapeHtml(lookupUrl)}</a> — enter your registration email to receive a one-time sign-in link.</p>
  <p style="line-height:1.6;margin:28px 0 4px 0;font-style:italic;color:#E8B96A;text-align:center;">"When we move, we move as one."</p>
  <p style="text-align:center;margin:0;color:#907050;font-size:13px;">— Keepers of the Current</p>
</div>
</body></html>`;

  const text = `${title}, ${c.name}.

${introduction}

  Recorded as: ${c.name}${houseLineText}
  Pursuing: ${ringsHuman}
  Registered gathering: ${c.event_name} — ${eventDates}

${c.bookings && c.bookings.length > 0 ? `Your booked trial times:
${c.bookings.map((b) => `  • ${fmtBookingSlot(b.trial_code, b.start_at, b.end_at)}`).join('\n')}
If you need to change a time, speak with the Keeper before the event.

` : c.preferred_date ? `Preferred session: ${c.preferred_date}${c.preferred_time ? ` at ${c.preferred_time}` : ''}
This is a preference, not a reserved appointment. Contact the Keeper to agree a time.

` : ''}${practicalText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEFORE YOU BEGIN — READ THIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Read the requirements for your chosen tier before you begin. Required parts
and witness attestations must be completed for the Keeper to record a pass.
If an attempt is incomplete, ask the Keeper about your next eligible attempt.
Health needs are respected.

Come ready. Take this seriously. The Scroll remembers.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

HOW THE TRIALS WORK:
  • Check in with the Keeper at Keepers Rest before starting. Confirm the meeting place, timing, and witness arrangements; do not assume the Keeper will find you.
  • Tier I is open to all Hynafol members. Tiers are sequential within each pillar — Tier I before Tier II,
    Tier II before Tier III. Tier II is attempted at a subsequent event after Tier I.
    You may work across pillars at the same event.
  • The final tier of every pillar (Tier III) may only be attempted at
    the Grand Gathering — once per year.

Full trial details: ${trialsUrl}

YOUR TRIALS — WHAT IS REQUIRED OF YOU:
${trialRulesText(c.rings_pursued)}

Track your standing at any time: ${lookupUrl}
Enter your registration email to receive a one-time sign-in link.

"When we move, we move as one."

— Keepers of the Current`;

  await sendViaResend(env, {
    from: env.EMAIL_FROM,
    to: [c.email],
    subject,
    html,
    text,
    reply_to: env.KEEPER_NOTIFY_EMAIL,
  }, c.idempotency_key);
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
    ? c.trial_intentions.map((i) => {
        const name = TRIAL_DISPLAY_NAMES[i.code] ?? i.code;
        return i.preferred_time ? `  • ${name} — prefers ${i.preferred_time}` : `  • ${name}`;
      }).join('\n')
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

export async function sendViaResend(env: Env, payload: ResendPayload, idempotencyKey?: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping send', { to: payload.to, subject: payload.subject });
    throw new Error('RESEND_API_KEY not configured');
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      ...(idempotencyKey ? {'Idempotency-Key': idempotencyKey} : {}),
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
  return `${name} · ${DAYS[dow]}, ${M[sm - 1]} ${sd}, ${datePart.slice(0, 4)} · ${fmtTime(startAt)}${endAmPm} Central Time`;
}

// Summaries of public/trials.html. Both confirmation and reminder formats use
// this single source so HTML, plain text, and the scheduled worker stay aligned.
const RULES = {
  body: [
    ['Tier I — The Fast + The Watch (both required)',
     'The Fast: abstain from food and drink except water for at least four hours at the event; health needs are respected. Agree the window with the Keeper in advance. It must be witnessed, and the Keeper or a Bearer releases you at the end.',
     'The Watch: stand unarmed guard at a sacred location or for a designated person for at least one hour. Do not speak unless spoken to. Do not leave without formal dismissal from the Keeper or your charge.',
     'Prepare: confirm your time window, witness, and Watch assignment with the Keeper before starting.'],
    ['Tier II — The Unison Drill (subsequent event)',
     'Learn the sword drill on your own, then teach it to two willing people before the next event. At a subsequent event, perform together before the Keeper: begin, move, and end in unison. The Keeper judges synchrony, not polish.',
     'Prepare: ask which drill and learning material to use, choose two willing partners, teach and practise together, and arrange the performance time.'],
    ['Tier III — The Burden + The Plank + The Foot Race (all required; Grand Gathering only)',
     'The Burden: on the designated day, carry the relic from the moment the Keeper gives it to you until the final bell. Do not set it down, transfer it, or ask for relief. The stated exception is when the Keeper requires it for her own use; reclaim it when she is finished. Surrendering it to anyone else resets this tier to the next Grand Gathering.',
     'The Plank: hold a plank until failure; your time is recorded publicly. The Foot Race: run 100 metres timed; the time is recorded on the Trial Leaderboard. These two proofs can be done on any day of the Grand Gathering. Finish all three before the closing ceremony.',
     'Prepare: arrange the relic handover and timed proofs with the Keeper.'],
  ],
  mind: [
    ['Tier I — The Dilemma or The Recitation (choose one)',
     'The Dilemma: reason aloud about the Keeper’s moral or philosophical question, without research or consulting others. Honest reasoning matters more than a correct conclusion.',
     'The Recitation: memorise a passage you choose and deliver it without reference. The Keeper judges whether the delivery is genuine, not just whether the words are exact.',
     'Prepare: book your chosen appointment. For the Recitation, choose and memorise your passage beforehand.'],
    ['Tier II — The Vow of Silence (subsequent event)',
     'Keep complete silence for at least three hours in the active spaces of the event, during a window chosen by the Keeper. No speech, whispers, or gesture-communication. A Bearer carries the sealed note “I am in the Vow.” If directly confronted, you may present it and then re-pocket it immediately.',
     'A Bearer (a member who holds at least one Ring) witnesses and attests at the end. If no Bearer is present, the Keeper witnesses.',
     'Prepare: arrange the window, witness, and note before beginning.'],
    ['Tier III — The Telling (Grand Gathering only)',
     'Organise and host your own real gathering with at least two people who are not members of the faith. Speak honestly, without a script, about what the Current is and what you believe, why you joined, and why you are doing the trials. This is not a recruitment pitch.',
     'The Keeper does not attend. Report back afterward about what it cost you, rather than reciting what was said.',
     'Prepare: arrange the gathering and invite your guests.'],
  ],
  soul: [
    ['Tier I — The Approach or The Gift (choose one)',
     'The Approach: have a meaningful conversation with someone you have never spoken to. Learn their name, house, and something true and personal about them. Return to the Keeper and recount what you learned as an introduction to that person.',
     'The Gift: make something by hand and give it to a stranger you have never spoken to. Do not explain the trial or ask for thanks or anything in return. Return to the Keeper and describe the person, why you chose them, and how giving felt.',
     'Prepare: for the Gift, make your item beforehand. Arrange time to report back to the Keeper.'],
    ['Tier II — The Service (subsequent event)',
     'Help prepare or facilitate someone else’s ritual, gathering, or event task on their terms. Do not seek recognition, steer it toward your own faith, or seek personal benefit. The person you serve, not the Keeper, witnesses and attests.',
     'Prepare: find a task and arrange the beneficiary’s attestation before they leave.'],
    ['Tier III — The Tea Ceremony + The Gift of the Coin (both required; Grand Gathering only)',
     'The Tea Ceremony: arrange a private meeting with the Keeper, away from the gathering. Share tea and honestly discuss what the trials have cost and changed in you. There is no audience or witness.',
     'The Gift of the Coin: someone has come to the Current through your presence, without pressure or recruitment. Design and host a public, witnessed ceremony and give them the Coin of the Keepers with your own hands and words. The new member must formally register their religion with the Keeper before the coin passes.',
     'Prepare: arrange the private tea, confirm the new member’s registration, and plan the public ceremony.'],
  ],
};
function trialRulesHtml(rings: ('body' | 'mind' | 'soul')[]): string {
  return rings.map(ring => `<h3 style="color:#E8B96A;">${escapeHtml(ringHumanList([ring]))}</h3>${RULES[ring].map(([title,...paragraphs]) => `<h4>${escapeHtml(title)}</h4>${paragraphs.map(p=>`<p style="line-height:1.6;">${escapeHtml(p)}</p>`).join('')}`).join('')}`).join('');
}
function trialRulesText(rings: ('body' | 'mind' | 'soul')[]): string {
  return rings.map(ring => `${ringHumanList([ring])}\n${RULES[ring].map(section => section.join('\n')).join('\n\n')}`).join('\n\n');
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
