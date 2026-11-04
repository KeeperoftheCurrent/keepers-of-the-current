import { exec, queryFirst, type Env } from './db';
import { normalizeEmail } from './validate';
import { sendViaResend } from './email';
import { emailLayout } from './email-layout';
import { jsonResponse } from '../_middleware';

const LINK_SECONDS = 15 * 60;
const SESSION_SECONDS = 8 * 60 * 60;
const COOKIE = '__Host-keeper-seeker';
const validToken = /^[0-9a-f-]{36}$/;

async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function sessionCookie(token: string, seconds: number): string {
  return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
}

async function issueLink(env: Env, email: string, ip: string, now: number, character = false) {
  const token = crypto.randomUUID();
  const tokenHash = await hash(token);
  const ipHash = await hash(ip);
  await exec(env, 'DELETE FROM seeker_sign_ins WHERE expires_at <= ?', now);
  const recipient = await queryFirst<{ seeker_id: string }>(env, `
    INSERT INTO seeker_sign_ins (token_hash, seeker_id, requester_ip, requested_at, expires_at)
    SELECT ?, s.id, ?, ?, ?
    FROM seekers s
    WHERE s.email_normalized = ?
      AND NOT EXISTS (
        SELECT 1 FROM seeker_sign_ins WHERE seeker_id = s.id AND requested_at > ?
      )
      AND (SELECT COUNT(*) FROM seeker_sign_ins WHERE requester_ip = ? AND requested_at > ?) < 5
    ORDER BY s.created_at, s.id
    LIMIT 1
    RETURNING seeker_id
  `, tokenHash, ipHash, now, now + LINK_SECONDS, email, now - 60, ipHash, now - 600);
  if (!recipient) return;

  const link = new URL('/lookup.html', env.SITE_URL);
  if (character) link.searchParams.set('next', 'character');
  const title = character ? 'Sign in to My character' : 'Sign in to My Trials';
  const purpose = character ? 'Write your story and tend your portrait in the Circle.' : 'See your saved progress and booked times.';
  link.hash = `sign-in=${token}`;
  try {
    await sendViaResend(env, {
    from: env.EMAIL_FROM,
    to: [email],
    subject: title,
    html: emailLayout(title,'<p>'+purpose+'</p><ul><li>This link works once.</li><li>It expires in <strong>15 minutes</strong>.</li><li>Keep it private: do not forward it.</li></ul><p>Didn’t request this? You can ignore this email.</p>',link.href,title),
    text: `${title}: ${link.href}\n\nThis link expires in 15 minutes and works once. ${purpose} Do not forward it. If you did not request it, ignore this email.\nNeed help? Reply to this email.`,
    reply_to: env.KEEPER_NOTIFY_EMAIL,
    });
  } catch (error) {
    // A failed send must not consume the recipient's resend allowance.
    await exec(env, 'DELETE FROM seeker_sign_ins WHERE token_hash = ? AND is_session = 0', tokenHash);
    throw error;
  }
}

export async function authenticateSeeker(context: EventContext<Env, string, unknown>):
  Promise<Response | { seekerId: string; cookie?: string }> {
  const { request, env } = context;
  if (request.headers.get('Origin') !== new URL(request.url).origin) {
    return jsonResponse({ ok: false }, 403);
  }
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const now = Math.floor(Date.now() / 1000);
  if (body?.action === 'request') {
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ ok: false }, 400);
    }
    context.waitUntil(issueLink(env, email, request.headers.get('CF-Connecting-IP') ?? '', now, body.next === 'character').catch(() => {
      console.error('[seeker sign-in] Unable to issue sign-in link');
    }));
    return jsonResponse({ ok: true }, 202);
  }

  if (body?.action === 'redeem' && typeof body.token === 'string' && validToken.test(body.token)) {
    const session = crypto.randomUUID();
    const row = await queryFirst<{ seeker_id: string }>(env, `
      UPDATE seeker_sign_ins SET token_hash = ?, is_session = 1, expires_at = ?
      WHERE token_hash = ? AND is_session = 0 AND expires_at > ?
      RETURNING seeker_id
    `, await hash(session), now + SESSION_SECONDS, await hash(body.token), now);
    return row
      ? { seekerId: row.seeker_id, cookie: sessionCookie(session, SESSION_SECONDS) }
      : jsonResponse({ ok: false }, 401);
  }

  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)__Host-keeper-seeker=([^;]+)/)?.[1];
  const tokenHash = token && validToken.test(token) ? await hash(token) : null;
  if (body?.action === 'logout') {
    if (tokenHash) await exec(env, 'DELETE FROM seeker_sign_ins WHERE token_hash = ? AND is_session = 1', tokenHash);
    return jsonResponse({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (body?.action === 'session' && tokenHash) {
    const row = await queryFirst<{ seeker_id: string }>(env, `
      SELECT seeker_id FROM seeker_sign_ins WHERE token_hash = ? AND is_session = 1 AND expires_at > ?
    `, tokenHash, now);
    if (row) return { seekerId: row.seeker_id };
  }
  return jsonResponse({ ok: false }, 401);
}
