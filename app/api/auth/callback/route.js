import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { env } from '@/lib/env';
import {
  normalizeShopDomain,
  verifyOAuthHmac,
  exchangeCodeForToken,
  signSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from '@/lib/shopify/auth';
import { finalizeInstall } from '@/lib/install';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shopDomain = normalizeShopDomain(searchParams.get('shop'));
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  if (!shopDomain || !code || !state) {
    return NextResponse.json({ error: 'Malformed OAuth callback' }, { status: 400 });
  }

  if (!verifyOAuthHmac(searchParams)) {
    return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 });
  }

  // The state must exist, be unused, and belong to this shop.
  const stateRow = await prisma.oAuthState.findUnique({ where: { state } });
  if (!stateRow || stateRow.shopDomain !== shopDomain) {
    return NextResponse.json({ error: 'Invalid or expired OAuth state' }, { status: 401 });
  }
  await prisma.oAuthState.delete({ where: { id: stateRow.id } });

  let tokenResponse;
  try {
    tokenResponse = await exchangeCodeForToken(shopDomain, code);
  } catch (error) {
    console.error('[pulseflow] token exchange failed', error);
    return NextResponse.json({ error: 'Could not complete installation with Shopify.' }, { status: 502 });
  }

  const now = Date.now();
  const tokenFields = {
    accessToken: tokenResponse.access_token,
    tokenExpiresAt: tokenResponse.expires_in ? new Date(now + tokenResponse.expires_in * 1000) : null,
    refreshToken: tokenResponse.refresh_token ?? null,
    refreshTokenExpiresAt: tokenResponse.refresh_token_expires_in
      ? new Date(now + tokenResponse.refresh_token_expires_in * 1000)
      : null,
  };

  const store = await prisma.store.upsert({
    where: { shopDomain },
    create: { shopDomain, ...tokenFields, installedAt: new Date() },
    update: {
      ...tokenFields,
      uninstalledAt: null,
      installedAt: new Date(),
      lastSyncError: null,
      // A reinstall must not restore a paid plan: Shopify cancelled the
      // subscription on uninstall, so nothing is being charged.
      plan: 'FREE',
      subscriptionId: null,
      subscriptionStatus: null,
      planActivatedAt: null,
    },
  });

  // Workflows are left as they were found. On a reinstall they stay PAUSED —
  // set that way by app/uninstalled — because resuming sends to customers
  // without the merchant asking is exactly the failure this app must not have.

  // Shared with the managed-installation path in lib/session.js, so a store
  // ends up in the same state however it got here. Failures inside are logged
  // and retried on the merchant's next page load rather than failing the
  // install they are in the middle of.
  await finalizeInstall(store);

  // OAuth runs in the top window (Shopify's consent screen refuses to be
  // framed), so send the merchant back into the Shopify admin rather than
  // leaving them on our bare domain. The admin then re-opens PulseFlow
  // embedded, which is where they expect to land after installing.
  const storeHandle = shopDomain.replace('.myshopify.com', '');
  const response = NextResponse.redirect(
    `https://admin.shopify.com/store/${storeHandle}/apps/${env.shopifyApiKey}`
  );
  response.cookies.set(SESSION_COOKIE, signSession(shopDomain), sessionCookieOptions);
  return response;
}
