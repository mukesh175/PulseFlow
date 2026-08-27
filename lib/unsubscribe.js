import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { env } from '@/lib/env';
import { normalizeEmail } from '@/lib/workflows/fingerprint';

/**
 * Per-customer unsubscribe.
 *
 * StorePulse's List-Unsubscribe header points at the merchant's own settings
 * page, which is right for an app that emails merchants. Here the recipient is
 * the merchant's customer, so the link has to resolve to that one person for
 * that one store, with no account and no login.
 *
 * The token is **derived, not stored**. A stored token would need a row to live
 * in, and the only row available — Suppression — means "this person has
 * unsubscribed". Creating one just to hold a token would mark every recipient
 * as opted out. So the token is a signed payload, the same shape as the session
 * cookie: it carries who it is for and proves we issued it.
 */

const SEPARATOR = '.';

function sign(payload) {
  return crypto.createHmac('sha256', env.sessionSecret).update(payload).digest('base64url');
}

/** Stable for a given store and address, so every message carries the same link. */
export function createUnsubscribeToken({ shopId, email }) {
  const payload = Buffer.from(JSON.stringify({ s: shopId, e: normalizeEmail(email) })).toString('base64url');
  return `${payload}${SEPARATOR}${sign(payload)}`;
}

export function verifyUnsubscribeToken(token) {
  if (typeof token !== 'string' || !token.includes(SEPARATOR)) return null;

  const [payload, signature] = token.split(SEPARATOR);
  const expected = sign(payload);

  // Length check first: timingSafeEqual throws on a mismatch rather than
  // returning false, and an attacker choosing the length should not be able to
  // turn a failed verification into a 500.
  if (expected.length !== signature.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.s || !data.e) return null;
    return { shopId: data.s, email: data.e };
  } catch {
    return null;
  }
}

export function unsubscribeUrl({ shopId, email }) {
  const token = createUnsubscribeToken({ shopId, email });
  return `${env.appUrl}/unsubscribe?token=${encodeURIComponent(token)}`;
}

/**
 * Record an opt-out.
 *
 * Idempotent: unsubscribing twice is the same as once, and a customer clicking
 * an old link after already opting out should see success, not an error.
 */
export async function suppress({ shopId, email, reason = 'unsubscribed' }) {
  const address = normalizeEmail(email);

  return prisma.suppression.upsert({
    where: { shopId_email: { shopId, email: address } },
    create: {
      shopId,
      email: address,
      reason,
      token: createUnsubscribeToken({ shopId, email: address }),
    },
    update: {},
  });
}

export async function isSuppressed({ shopId, email }) {
  const row = await prisma.suppression.findUnique({
    where: { shopId_email: { shopId, email: normalizeEmail(email) } },
    select: { id: true },
  });
  return row !== null;
}
