import prisma from '@/lib/prisma';

/**
 * Record an access to protected customer data.
 *
 * StorePulse logged this because Shopify's protected customer data terms
 * require it. PulseFlow needs it for a second reason: when a merchant asks why
 * a customer received a message, this log plus MessageLog is the answer.
 */
/**
 * Who caused the access.
 *
 * The privacy policy distinguishes "a merchant viewing a screen" from "an
 * automated job", so the log has to be able to tell them apart. A single
 * undifferentiated count would not answer the question the policy promises to
 * answer.
 */
export const ACTOR = {
  MERCHANT: 'merchant',
  SYSTEM: 'system',
};

/**
 * Record a read of customer name or email caused by a merchant looking at a
 * screen. Never records the personal data itself — only that it was accessed,
 * by whom, and how much of it.
 */
export function logCustomerDataAccess({ shopId, action, recordCount = 0, detail = null }) {
  return logPrivacyAction(shopId, action, recordCount, `${ACTOR.MERCHANT}: ${detail ?? action}`);
}

export async function logPrivacyAction(shopId, action, recordCount = 0, detail = null) {
  try {
    await prisma.dataAccessLog.create({
      data: { shopId, action, recordCount, detail: detail ? String(detail).slice(0, 500) : null },
    });
  } catch (error) {
    // Audit logging must never take down the operation it is describing.
    console.error('[pulseflow] audit log failed', error);
  }
}
