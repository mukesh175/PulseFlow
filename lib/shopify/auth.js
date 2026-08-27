import crypto from 'crypto';
import { env } from '@/lib/env';

const SHOP_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export function isValidShopDomain(shop) {
  return typeof shop === 'string' && SHOP_DOMAIN_RE.test(shop);
}

export function normalizeShopDomain(shop) {
  if (!shop) return null;
  const cleaned = String(shop).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return isValidShopDomain(cleaned) ? cleaned : null;
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify the `hmac` parameter Shopify appends to OAuth / embedded-app requests.
 */
export function verifyOAuthHmac(searchParams) {
  const params = new URLSearchParams(searchParams);
  const hmac = params.get('hmac');
  if (!hmac) return false;
  params.delete('hmac');
  params.delete('signature');

  const message = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const digest = crypto.createHmac('sha256', env.shopifyApiSecret).update(message).digest('hex');
  return timingSafeEqual(digest, hmac);
}

/**
 * Verify the base64 `X-Shopify-Hmac-Sha256` header sent with webhooks.
 * `rawBody` must be the exact bytes Shopify sent.
 */
export function verifyWebhookHmac(rawBody, headerHmac) {
  if (!headerHmac) return false;
  const digest = crypto.createHmac('sha256', env.shopifyApiSecret).update(rawBody, 'utf8').digest('base64');
  return timingSafeEqual(digest, headerHmac);
}

export function generateOAuthState() {
  return crypto.randomBytes(24).toString('hex');
}

export function buildInstallUrl(shopDomain, state) {
  const params = new URLSearchParams({
    client_id: env.shopifyApiKey,
    scope: env.scopes,
    redirect_uri: `${env.appUrl}/api/auth/callback`,
    state,
  });
  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

async function postTokenRequest(shopDomain, params) {
  const res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params).toString(),
  });

  if (!res.ok) {
    const detail = await res.text();
    const error = new Error(`Shopify token request failed (${res.status}): ${detail.slice(0, 300)}`);
    error.status = res.status;
    throw error;
  }

  return res.json();
}

/**
 * `expiring=1` is required: Shopify stopped accepting non-expiring offline
 * tokens in December 2025. The response carries an access token good for one
 * hour plus a refresh token good for 90 days.
 *
 * Returns { access_token, expires_in, refresh_token, refresh_token_expires_in, scope }.
 */
export async function exchangeCodeForToken(shopDomain, code) {
  return postTokenRequest(shopDomain, {
    client_id: env.shopifyApiKey,
    client_secret: env.shopifyApiSecret,
    code,
    expiring: '1',
  });
}

/**
 * Exchange a verified App Bridge session token for an offline access token.
 *
 * This is how an embedded app obtains credentials under Shopify managed
 * installation, where the merchant is granted access without ever passing
 * through our OAuth callback. No redirect, no leaving the admin iframe.
 */
export async function exchangeSessionTokenForAccessToken(shopDomain, sessionToken) {
  return postTokenRequest(shopDomain, {
    client_id: env.shopifyApiKey,
    client_secret: env.shopifyApiSecret,
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    subject_token: sessionToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    requested_token_type: 'urn:shopify:params:oauth:token-type:offline-access-token',
    expiring: '1',
  });
}

/**
 * Redeem a refresh token for a new access token. Requires no session token and
 * no user present, so scheduled jobs can refresh on their own.
 */
export async function refreshAccessToken(shopDomain, refreshToken) {
  return postTokenRequest(shopDomain, {
    client_id: env.shopifyApiKey,
    client_secret: env.shopifyApiSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

// ---------------------------------------------------------------------------
// App session cookie (signed, HTTP-only). The access token never leaves the
// server; the cookie only carries the shop domain.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'pf_session';

export function signSession(shopDomain) {
  const payload = Buffer.from(JSON.stringify({ shop: shopDomain, iat: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function readSession(cookieValue) {
  if (!cookieValue || !cookieValue.includes('.')) return null;
  const [payload, sig] = cookieValue.split('.');
  const expected = crypto.createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!isValidShopDomain(data.shop)) return null;
    // Sessions are valid for 30 days.
    if (Date.now() - Number(data.iat) > 30 * 24 * 60 * 60 * 1000) return null;
    return data;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  // Shopify renders the app in an iframe, so the cookie must be cross-site.
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
  maxAge: 30 * 24 * 60 * 60,
};
