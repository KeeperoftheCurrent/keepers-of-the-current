// Gate for /api/admin/* — verifies Cloudflare Access's Cf-Access-Jwt-Assertion
// header against the team's JWKS. Stashes the verified email on context.data
// so downstream handlers can attribute writes.
//
// Local-dev bypass: when SITE_URL points at localhost, accept a debug header
// X-Local-Admin-Email instead of a real Access JWT. Production deploys never
// see localhost in SITE_URL, so this branch is unreachable in prod.

import type { Env } from '../../lib/db';
import { jsonResponse } from '../../_middleware';
import { verifyAccessJWT, type AccessUser } from '../../lib/access';

export type AdminContextData = {
  user: AccessUser;
  [key: string]: unknown;
};

export const onRequest: PagesFunction<Env, string, AdminContextData> = async (context) => {
  const { request, env } = context;

  // Local-dev bypass — gated by env.SITE_URL containing 'localhost', not by anything
  // user-controllable in the request. Production env never has this in SITE_URL.
  if (env.SITE_URL && env.SITE_URL.includes('localhost')) {
    const debugEmail = request.headers.get('X-Local-Admin-Email') || 'localdev@keepersofthecurrent.org';
    context.data.user = { email: debugEmail };
    return await context.next();
  }

  const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt) {
    return jsonResponse({ ok: false, error: 'Missing Access JWT' }, 401);
  }
  if (!env.CF_ACCESS_AUD || !env.CF_ACCESS_TEAM_DOMAIN) {
    return jsonResponse({ ok: false, error: 'Access not configured (CF_ACCESS_AUD / CF_ACCESS_TEAM_DOMAIN unset)' }, 500);
  }
  try {
    const user = await verifyAccessJWT(jwt, env.CF_ACCESS_AUD, env.CF_ACCESS_TEAM_DOMAIN);
    context.data.user = user;
  } catch (err) {
    console.error('[admin auth] JWT verify failed:', err);
    return jsonResponse({ ok: false, error: 'Invalid Access JWT' }, 401);
  }

  return await context.next();
};
