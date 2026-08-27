import prisma from '@/lib/prisma';
import { refreshAccessToken } from '@/lib/shopify/auth';

/** Refresh a little early so a request never races the expiry. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class ReauthRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReauthRequiredError';
    this.status = 401;
    this.reauthRequired = true;
  }
}

/**
 * True when the store holds credentials Shopify will no longer accept and no
 * way to refresh them — the only cure is a fresh OAuth grant.
 */
export function needsReconnect(store) {
  if (!store) return false;
  return !store.refreshToken || !store.tokenExpiresAt;
}

export function tokenIsFresh(store) {
  // Tokens issued before the expiring-token migration have no expiry recorded.
  // Shopify rejects those, so treat them as stale and force a refresh.
  if (!store.tokenExpiresAt) return false;
  return store.tokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now();
}

export function persistTokenResponse(shopId, payload) {
  const now = Date.now();
  return prisma.store.update({
    where: { id: shopId },
    data: {
      accessToken: payload.access_token,
      tokenExpiresAt: payload.expires_in ? new Date(now + payload.expires_in * 1000) : null,
      refreshToken: payload.refresh_token ?? null,
      refreshTokenExpiresAt: payload.refresh_token_expires_in
        ? new Date(now + payload.refresh_token_expires_in * 1000)
        : null,
    },
  });
}

/**
 * Return a store object whose access token is valid right now, refreshing it
 * first if needed. Every Shopify call goes through this.
 */
export async function ensureFreshToken(store, { force = false } = {}) {
  if (!force && tokenIsFresh(store)) return store;

  if (!store.refreshToken) {
    throw new ReauthRequiredError(
      'This store was connected before Shopify required expiring tokens. Reinstall PulseFlow to reconnect it.'
    );
  }

  if (store.refreshTokenExpiresAt && store.refreshTokenExpiresAt.getTime() <= Date.now()) {
    throw new ReauthRequiredError(
      'The connection to Shopify expired after 90 days of inactivity. Reinstall PulseFlow to reconnect it.'
    );
  }

  let payload;
  try {
    payload = await refreshAccessToken(store.shopDomain, store.refreshToken);
  } catch (error) {
    if (error.status === 400 || error.status === 401) {
      throw new ReauthRequiredError('Shopify rejected the stored credentials. Reinstall PulseFlow to reconnect.');
    }
    throw error;
  }

  const updated = await persistTokenResponse(store.id, payload);
  // Preserve any relations the caller had loaded (settings, preference…).
  return { ...store, ...updated };
}
