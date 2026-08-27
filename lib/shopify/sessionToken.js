/**
 * Shopify session token (id_token) verification.
 *
 * App Bridge issues a short-lived JWT identifying the shop and user for every
 * embedded request. Verifying it is what makes authentication independent of
 * third-party cookies, which browsers increasingly block inside the Shopify
 * admin iframe.
 *
 * Implemented with Web Crypto so the same code runs in middleware (edge) and
 * in route handlers (node).
 */

const encoder = new TextEncoder();

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64UrlFromBytes(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function hmacSign(secret, message) {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return base64UrlFromBytes(signature);
}

export class SessionTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SessionTokenError';
    this.status = 401;
  }
}

/**
 * Verify signature and claims. Returns { shop, userId, expiresAt }.
 * Throws SessionTokenError for anything that does not check out.
 */
export async function verifySessionToken(token, { apiKey, apiSecret }) {
  if (!token || typeof token !== 'string') throw new SessionTokenError('Missing session token');

  const parts = token.split('.');
  if (parts.length !== 3) throw new SessionTokenError('Malformed session token');
  const [headerPart, payloadPart, signaturePart] = parts;

  const expected = await hmacSign(apiSecret, `${headerPart}.${payloadPart}`);
  // Constant-time-ish comparison; lengths are equal for valid HS256 output.
  if (expected.length !== signaturePart.length) throw new SessionTokenError('Invalid session token signature');
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ signaturePart.charCodeAt(i);
  if (mismatch !== 0) throw new SessionTokenError('Invalid session token signature');

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadPart));
  } catch {
    throw new SessionTokenError('Unreadable session token payload');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  // 10s leeway absorbs clock skew between Shopify and the server.
  if (typeof payload.exp === 'number' && payload.exp < nowSeconds - 10) {
    throw new SessionTokenError('Session token has expired');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > nowSeconds + 10) {
    throw new SessionTokenError('Session token is not valid yet');
  }
  if (payload.aud !== apiKey) {
    throw new SessionTokenError('Session token was issued for a different app');
  }

  // `dest` is the shop the token was minted for — the only trustworthy source
  // of the shop identity for this request.
  let shop;
  try {
    shop = new URL(payload.dest).hostname;
  } catch {
    throw new SessionTokenError('Session token has no valid destination');
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new SessionTokenError('Session token destination is not a Shopify store');
  }

  return {
    shop,
    userId: payload.sub ?? null,
    expiresAt: payload.exp ? new Date(payload.exp * 1000) : null,
  };
}
