// Cloudflare Access JWT verification.
// Used by functions/api/admin/_middleware.ts to gate /api/admin/* routes.
//
// Cloudflare injects Cf-Access-Jwt-Assertion on every request that has passed
// through Access. We verify the signature against the team's JWKS endpoint,
// confirm the audience matches our app's AUD tag, and stash the email claim
// for downstream handlers.

import { jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';

interface AccessClaims extends JWTPayload {
  email?: string;
}

let cachedJWKS: ReturnType<typeof createRemoteJWKSet> | null = null;
let cachedTeamDomain: string | null = null;

function getJWKS(teamDomain: string) {
  if (!cachedJWKS || cachedTeamDomain !== teamDomain) {
    cachedJWKS = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`));
    cachedTeamDomain = teamDomain;
  }
  return cachedJWKS;
}

export interface AccessUser {
  email: string;
}

export async function verifyAccessJWT(
  jwt: string,
  expectedAud: string,
  teamDomain: string
): Promise<AccessUser> {
  const issuer = `https://${teamDomain}`;
  const { payload } = await jwtVerify<AccessClaims>(jwt, getJWKS(teamDomain), {
    issuer,
    audience: expectedAud,
  });
  if (!payload.email) {
    throw new Error('JWT verified but missing email claim');
  }
  return { email: payload.email };
}
