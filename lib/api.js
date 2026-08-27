import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import prisma from '@/lib/prisma';
import { env } from '@/lib/env';
import { verifySessionToken, SessionTokenError } from '@/lib/shopify/sessionToken';
import { getCurrentStore } from '@/lib/session';
import { ReauthRequiredError } from '@/lib/shopify/token';
import { ShopifyApiError } from '@/lib/shopify/client';

export class UnauthorizedError extends Error {
  constructor(message = 'Not authenticated') {
    super(message);
    this.name = 'UnauthorizedError';
    this.status = 401;
  }
}

/**
 * Resolve the store for an API request.
 *
 * Client-side calls send a fresh App Bridge session token as a bearer token,
 * which is the strongest identity available and does not depend on cookies
 * surviving as third-party in the admin iframe. Middleware only inspects the
 * `id_token` query parameter on document requests, so the bearer path is
 * verified here rather than there.
 */
export async function requireStore() {
  const headerList = await headers();
  const authorization = headerList.get('authorization') || '';

  if (authorization.startsWith('Bearer ')) {
    try {
      const { shop } = await verifySessionToken(authorization.slice(7), {
        apiKey: env.shopifyApiKey,
        apiSecret: env.shopifyApiSecret,
      });
      const store = await prisma.store.findUnique({ where: { shopDomain: shop } });
      if (store && !store.uninstalledAt) return store;
      throw new UnauthorizedError('This store is not installed');
    } catch (error) {
      if (error instanceof SessionTokenError) throw new UnauthorizedError(error.message);
      throw error;
    }
  }

  const store = await getCurrentStore({ autoInstall: false });
  if (!store || store.uninstalledAt) throw new UnauthorizedError();
  return store;
}

/**
 * Wrap a route handler so the errors that actually occur become the right
 * status codes instead of an opaque 500.
 */
export function withStore(handler) {
  return async function wrapped(...args) {
    try {
      return await handler(...args);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return NextResponse.json({ error: error.message }, { status: 401 });
      }
      if (error instanceof ReauthRequiredError) {
        // The client turns this flag into the reconnect prompt.
        return NextResponse.json({ error: error.message, reauthRequired: true }, { status: 401 });
      }
      if (error instanceof ShopifyApiError) {
        return NextResponse.json({ error: error.message }, { status: 502 });
      }
      console.error('[pulseflow] api error', error);
      return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
    }
  };
}
