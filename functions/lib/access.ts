// Cloudflare Access JWT verification using built-in WebCrypto only.
// No external deps — Pages's CI container doesn't run `npm install` (it skips
// the build step when no build command is configured), so any import from
// node_modules breaks the bundle. Cloudflare Access signs with RS256 which
// crypto.subtle handles natively.

interface AccessClaims {
  email?: string;
  aud?: string | string[];
  iss?: string;
  exp?: number;
  iat?: number;
  sub?: string;
  [key: string]: unknown;
}

interface JWTHeader {
  alg: string;
  kid: string;
  typ?: string;
}

interface JWK {
  kty: string;
  kid: string;
  use?: string;
  n: string;
  e: string;
  alg?: string;
}

interface JWKS {
  keys: JWK[];
}

// In-memory cache shared across requests in the same isolate.
let cachedKeys: { teamDomain: string; keys: JWK[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000; // 1 hour

async function getJWKS(teamDomain: string): Promise<JWK[]> {
  const now = Date.now();
  if (
    cachedKeys &&
    cachedKeys.teamDomain === teamDomain &&
    now - cachedKeys.fetchedAt < JWKS_TTL_MS
  ) {
    return cachedKeys.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const data = (await res.json()) as JWKS;
  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    throw new Error('JWKS returned no keys');
  }
  cachedKeys = { teamDomain, keys: data.keys, fetchedAt: now };
  return data.keys;
}

function base64UrlDecodeToBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const base64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(input: string): string {
  return new TextDecoder().decode(base64UrlDecodeToBytes(input));
}

async function importPublicKey(jwk: JWK): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: jwk.alg ?? 'RS256',
      ext: true,
    },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

export interface AccessUser {
  email: string;
}

export async function verifyAccessJWT(
  jwt: string,
  expectedAud: string,
  teamDomain: string
): Promise<AccessUser> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT (expected 3 parts)');
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: JWTHeader;
  try {
    header = JSON.parse(base64UrlDecodeToString(headerB64));
  } catch {
    throw new Error('JWT header not valid JSON');
  }
  if (header.alg !== 'RS256') throw new Error(`Unsupported alg: ${header.alg}`);
  if (!header.kid) throw new Error('JWT missing kid');

  const keys = await getJWKS(teamDomain);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Force one cache refresh in case Cloudflare rotated keys.
    cachedKeys = null;
    const refreshed = await getJWKS(teamDomain);
    jwk = refreshed.find((k) => k.kid === header.kid);
    if (!jwk) throw new Error(`No JWKS key matched kid=${header.kid}`);
  }

  const publicKey = await importPublicKey(jwk);
  const signed = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const signature = base64UrlDecodeToBytes(signatureB64);
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    publicKey,
    signature,
    signed
  );
  if (!valid) throw new Error('JWT signature invalid');

  let claims: AccessClaims;
  try {
    claims = JSON.parse(base64UrlDecodeToString(payloadB64));
  } catch {
    throw new Error('JWT payload not valid JSON');
  }

  const expectedIss = `https://${teamDomain}`;
  if (claims.iss !== expectedIss) {
    throw new Error(`JWT iss mismatch (got ${claims.iss}, expected ${expectedIss})`);
  }

  const audMatches = Array.isArray(claims.aud)
    ? claims.aud.includes(expectedAud)
    : claims.aud === expectedAud;
  if (!audMatches) throw new Error('JWT aud mismatch');

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp < now) {
    throw new Error('JWT expired');
  }

  if (!claims.email) throw new Error('JWT verified but missing email claim');
  return { email: claims.email };
}
