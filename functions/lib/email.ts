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
  const eventDates = c.event_starts_on && c.event_ends_on
    ? `${c.event_starts_on} → ${c.event_ends_on}`
    : 'dates to be announced';
  const houseLine = c.house ? ` of House ${escapeHtml(c.house)}` : '';
  const houseLineText = c.house ? ` of House ${c.house}` : '';
  const lookupUrl = `${env.SITE_URL}/lookup.html`;

  const subject = `The Current acknowledges you, ${c.name}`;

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#0e0404;font-family:Georgia,'Times New Roman',serif;color:#f0dfc0;">
<div style="max-width:560px;margin:0 auto;background:rgba(42,14,14,0.7);border:1px solid rgba(200,150,62,0.25);border-radius:6px;padding:32px;">
  <h1 style="color:#C8963E;font-size:22px;margin:0 0 16px 0;letter-spacing:0.5px;">The Current acknowledges you</h1>
  <p style="line-height:1.6;margin:0 0 16px 0;">The Keeper has marked your name in the Trial Scroll.</p>
  <div style="border-top:1px solid rgba(200,150,62,0.25);border-bottom:1px solid rgba(200,150,62,0.25);padding:18px 0;margin:18px 0;">
    <p style="margin:0 0 8px 0;"><span style="color:#907050;">Recorded as:</span> <strong style="color:#E8B96A;">${escapeHtml(c.name)}</strong>${houseLine}</p>
    <p style="margin:0 0 8px 0;"><span style="color:#907050;">Pursuing:</span> ${escapeHtml(ringsHuman)}</p>
    <p style="margin:0;"><span style="color:#907050;">First gathering:</span> ${escapeHtml(c.event_name)} <span style="color:#907050;">— ${escapeHtml(eventDates)}</span></p>
  </div>
  <p style="line-height:1.6;margin:0 0 12px 0;"><strong style="color:#E8B96A;">What happens next:</strong></p>
  <ul style="line-height:1.7;margin:0 0 16px 0;padding-left:20px;">
    <li>Arrive at the event ready in body and mind. The Keeper will recognize you.</li>
    <li>The Trials may be undertaken in any order, in any pillar, at any event &mdash; except those of the Body's third tier, which belong to the Grand Gathering alone.</li>
    <li>You may view your standing at any time at <a href="${escapeAttr(lookupUrl)}" style="color:#C8963E;">${escapeHtml(lookupUrl)}</a> &mdash; your name and this address are the key.</li>
  </ul>
  <p style="line-height:1.6;margin:24px 0 4px 0;font-style:italic;color:#E8B96A;text-align:center;">"When we move, we move as one."</p>
  <p style="text-align:center;margin:0;color:#907050;font-size:13px;">— Keepers of the Current</p>
</div>
</body></html>`;

  const text = `The Current acknowledges you, ${c.name}.

The Keeper has marked your name in the Trial Scroll.

  Recorded as: ${c.name}${houseLineText}
  Pursuing: ${ringsHuman}
  First gathering: ${c.event_name} — ${eventDates}

What happens next:
  • Arrive at the event ready in body and mind. The Keeper will recognize you.
  • The Trials may be undertaken in any order, in any pillar, at any event —
    except those of the Body's third tier, which belong to the Grand Gathering alone.
  • You may view your standing at any time at ${lookupUrl} —
    your name and this address are the key.

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
