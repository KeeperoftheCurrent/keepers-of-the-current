// Resend integration + the two transactional emails sent on intake.
// The seeker confirmation is in-fiction (dark + gold theme); the admin
// notification is terse and operational. Final copy reviewed by Dez in Phase 4.

import type { Env } from './db';
import guides from '../../public/assets/data/trial-guides.json';
import { emailLayout, emailList } from './email-layout';

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
  appointment_reminder?: boolean;
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
  const title = c.appointment_reminder ? 'Your trial appointment is tomorrow' : c.reminder ? 'Your gathering begins tomorrow' : 'Your trial plan is saved';
  const subject = c.reminder || c.appointment_reminder ? `Tomorrow — ${c.event_name} — your trials` : `Trial plan saved — ${c.event_name}`;
  const lookupUrl = `${env.SITE_URL}/lookup.html`;
  const codes = [...(c.bookings ?? []).map(b=>b.trial_code), ...(c.trial_intentions ?? []).map(i=>i.code)];
  const selected = Object.entries(guides).filter(([id])=>codes.some(code=>code.startsWith(id[0]+'_t'+id.slice(-1))));
  const booked = (c.bookings ?? []).map(b=>fmtBookingSlot(b.trial_code,b.start_at,b.end_at));
  const planned = (c.trial_intentions ?? []).map(i=>`${TRIAL_DISPLAY_NAMES[i.code] ?? i.code}${i.preferred_time ? ` — preferred: ${i.preferred_time.includes('T') ? fmtBookingSlot(i.code,i.preferred_time,'') : i.preferred_time}` : ''}`);
  if(c.preferred_date && !booked.length) planned.push(`Preferred session: ${c.preferred_date}${c.preferred_time ? ' at '+c.preferred_time : ''}`);
  const next = [
    'Before starting: check in with the Keeper at Keepers Rest. Confirm your meeting place, timing and any required witness.',
    'Prepare using your checklists below. Discuss access or health needs with the Keeper; health needs are respected.',
    'After your attempt: report back with any witness attestation. Progress updates when the Keeper records the result.'
  ];
  const heading = (title: string)=>`<h2 style="font-size:21px;line-height:1.3;margin:28px 0 12px;color:#64420a;">${escapeHtml(title)}</h2>`;
  const ruleHtml = selected.map(([id,g])=>`${heading(g.title)}<p><strong>${escapeHtml(g.when)}</strong></p><h3 style="font-size:18px;">Prepare</h3>${emailList(g.prepare)}${g.steps.map(([step,...items])=>`<h3 style="font-size:18px;">${escapeHtml(step)}</h3>${emailList(items)}`).join('')}<p><strong>Finish:</strong> ${escapeHtml(g.finish)}</p><p><a style="color:#64420a;" href="${escapeAttr(env.SITE_URL+'/trials.html#'+id)}">Full rules &amp; lore for this trial</a></p>`).join('');
  const content = `<p>Hello ${escapeHtml(c.name)}.</p><p><strong>${escapeHtml(c.event_name)}</strong><br>${escapeHtml(fmtEventDates(c.event_starts_on,c.event_ends_on))}</p>${heading('Booked times')}${booked.length ? emailList(booked) : '<p>No appointment times reserved.</p>'}<p>All times are Central Time (America/Chicago).</p>${planned.length ? heading('Planned trials — no time reserved')+emailList(planned)+'<p>Agree on timing with the Keeper. Preferences and Discord “Interested” responses do not reserve appointments.</p>' : ''}${heading('Your next steps')}${emailList(next)}<p>Use My Trials to view progress, change or cancel a booking, or download it for your calendar. Enter your registration email for a one-time sign-in link.</p>`;
  const html = emailLayout(title,content,lookupUrl,'View My Trials',ruleHtml);
  const ruleText = selected.map(([id,g])=>`${g.title}\n${g.when}\nPrepare:\n${g.prepare.map(x=>'• '+x).join('\n')}\n${g.steps.map(([step,...items])=>step+'\n'+items.map(x=>'• '+x).join('\n')).join('\n')}\nFinish: ${g.finish}\nFull rules: ${env.SITE_URL}/trials.html#${id}`).join('\n\n');
  const text = `${title}\nHello ${c.name}.\n${c.event_name} — ${fmtEventDates(c.event_starts_on,c.event_ends_on)}\n\nBOOKED TIMES\n${booked.join('\n') || 'No appointment times reserved.'}\nAll times are Central Time (America/Chicago).\n${planned.length ? '\nPLANNED TRIALS — no time reserved\n'+planned.join('\n')+'\nAgree on timing with the Keeper. Preferences and Discord Interested responses do not reserve appointments.\n' : ''}\nYOUR NEXT STEPS\n${next.map(x=>'• '+x).join('\n')}\n\nUse My Trials to view progress, change or cancel a booking, or download it for your calendar. Enter your registration email for a one-time sign-in link.\n${lookupUrl}\n\n${ruleText}\n\nNeed help? Reply to this email.`;

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
    ? c.bookings.map((b) => `  • ${fmtBookingSlot(b.trial_code,b.start_at,b.end_at)}`).join('\n')
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

BOOKED TIMES (Central Time):
${bookingsText}

PLANNED TRIALS (no time reserved — confirm arrangements):
${intentionsText}

Open the panel: ${adminUrl}`;

  const html = emailLayout('New trial registration',`<p><strong>${escapeHtml(c.name)}</strong>${c.house ? ' · '+escapeHtml(c.house) : ''}<br>${escapeHtml(c.email)}<br>${escapeHtml(c.event_name)}</p><h2>Booked times</h2>${emailList((c.bookings??[]).map(b=>fmtBookingSlot(b.trial_code,b.start_at,b.end_at)))}<h2>Planned — no time reserved</h2>${emailList((c.trial_intentions??[]).map(i=>(TRIAL_DISPLAY_NAMES[i.code]??i.code)+(i.preferred_time?' — preferred: '+i.preferred_time:'')))}<p>Confirm arrangements for planned trials with the seeker.</p>`,adminUrl,'Open Keeper’s Panel');

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

export async function sendProgressUpdate(env: Env, seekerId: string, trialCode: string, outcome: string) {
 const seeker=await env.DB.prepare('SELECT name,email FROM seekers WHERE id=?').bind(seekerId).first<{name:string;email:string}>();
 if(!seeker)return;
 const text=`${seeker.name}, your Trial Scroll has been updated.\n${TRIAL_DISPLAY_NAMES[trialCode]||trialCode}: ${outcome==='passed'?'Passed':'Attempt recorded — ask the Keeper about your next eligible attempt'}.\nView your progress and next steps: ${env.SITE_URL}/lookup.html\nIf anything looks wrong, reply to this email.`;
 await sendViaResend(env,{from:env.EMAIL_FROM,to:[seeker.email],subject:'Your trial progress has been updated',text,html:emailLayout('Your progress has been updated',`<p>${escapeHtml(text).replace(/\n/g,'</p><p>')}</p>`,env.SITE_URL+'/lookup.html'),reply_to:env.KEEPER_NOTIFY_EMAIL});
}

export async function sendBookingUpdate(env: Env, seekerId: string, trialCode: string, action: string, start: string) {
 const seeker=await env.DB.prepare('SELECT name,email FROM seekers WHERE id=?').bind(seekerId).first<{name:string;email:string}>();
 if(!seeker)return;
 const text=`${seeker.name}, your appointment has been ${action==='cancel'?'canceled':'rescheduled'}.\n${fmtBookingSlot(trialCode,start,'')}\nYour recorded progress is unchanged. View My Trials: ${env.SITE_URL}/lookup.html\nUpdate any copy in your personal calendar. Reply if you need help.`;
 await sendViaResend(env,{from:env.EMAIL_FROM,to:[seeker.email],subject:action==='cancel'?'Trial appointment canceled':'Trial appointment rescheduled',text,html:emailLayout(action==='cancel'?'Appointment canceled':'Appointment rescheduled',`<p>${escapeHtml(text).replace(/\n/g,'</p><p>')}</p>`,env.SITE_URL+'/lookup.html'),reply_to:env.KEEPER_NOTIFY_EMAIL});
 await sendViaResend(env,{from:env.EMAIL_FROM,to:[env.KEEPER_NOTIFY_EMAIL],subject:'Seeker booking change',text,html:emailLayout('Your trial update',`<p>${escapeHtml(text).replace(/\n/g,'</p><p>')}</p>`,env.SITE_URL+'/lookup.html')});
}
