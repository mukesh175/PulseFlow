import prisma from '@/lib/prisma';

/**
 * Record an access to protected customer data.
 *
 * StorePulse logged this because Shopify's protected customer data terms
 * require it. PulseFlow needs it for a second reason: when a merchant asks why
 * a customer received a message, this log plus MessageLog is the answer.
 */
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
