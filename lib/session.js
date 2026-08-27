import { headers, cookies } from 'next/headers';
import prisma from '@/lib/prisma';
import { env } from '@/lib/env';
import {
  SESSION_COOKIE,
  readSession,
  normalizeShopDomain,
  exchangeSessionTokenForAccessToken,
} from '@/lib/shopify/auth';

/**
 * Resolve the store for the current request.
 *
 * Two sources, in order of trust:
 *
 * 1. `x-pulseflow-shop`, set by middleware only after it verified the App
 *    Bridge session token's signature. This is the authoritative identity.
 * 2. The signed `pf_session` cookie, for same-document navigations that carry
 *    no fresh token.
 *
 * Under Shopify managed installation a merchant can be granted access without
 * ever passing through our OAuth callback, so the first embedded request may
 * find a verified shop with no Store row. In that case we complete the install
 * by exchanging the session token for an offline access token — no redirect,
 * no leaving the admin iframe.
 */
export async function getCurrentStore({ autoInstall = true } = {}) {
  const headerList = await headers();
  const cookieStore = await cookies();

  const verifiedShop = normalizeShopDomain(headerList.get('x-pulseflow-shop'));
  const idToken = headerList.get('x-pulseflow-id-token');

  const shopDomain =
    verifiedShop ?? normalizeShopDomain(readSession(cookieStore.get(SESSION_COOKIE)?.value)?.shop);

  if (!shopDomain) return null;

  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (store && !store.uninstalledAt) return store;

  // Only a token we verified this request may bootstrap an install — a cookie
  // alone must never be able to create a Store row.
  if (!autoInstall || !verifiedShop || !idToken) return store ?? null;

  return completeManagedInstall(verifiedShop, idToken);
}

async function completeManagedInstall(shopDomain, idToken) {
  let payload;
  try {
    payload = await exchangeSessionTokenForAccessToken(shopDomain, idToken);
  } catch (error) {
    console.error('[pulseflow] token exchange failed', error);
    return null;
  }

  const now = Date.now();
  const tokenFields = {
    accessToken: payload.access_token,
    tokenExpiresAt: payload.expires_in ? new Date(now + payload.expires_in * 1000) : null,
    refreshToken: payload.refresh_token ?? null,
    refreshTokenExpiresAt: payload.refresh_token_expires_in
      ? new Date(now + payload.refresh_token_expires_in * 1000)
      : null,
  };

  return prisma.store.upsert({
    where: { shopDomain },
    create: { shopDomain, ...tokenFields, installedAt: new Date() },
    update: {
      ...tokenFields,
      uninstalledAt: null,
      installedAt: new Date(),
      lastSyncError: null,
      // A reinstall must not silently restore a paid plan: Shopify cancelled
      // the subscription on uninstall, so nothing is being charged.
      plan: 'FREE',
      subscriptionId: null,
      subscriptionStatus: null,
      planActivatedAt: null,
    },
  });
}

/** The admin URL for this app, for breaking out of the iframe when needed. */
export function adminAppUrl(shopDomain) {
  const handle = shopDomain.replace('.myshopify.com', '');
  return `https://admin.shopify.com/store/${handle}/apps/${env.shopifyApiKey}`;
}
