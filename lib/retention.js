import prisma from '@/lib/prisma';

/**
 * Retention periods, in days.
 *
 * Declared in one place because the privacy policy quotes these numbers. If a
 * value changes here, the policy is wrong until it changes too.
 */
export const RETENTION_DAYS = {
  /// Raw webhook bodies. Kept only long enough to investigate a delivery
  /// problem; they contain customer data and are the shortest-lived thing we
  /// hold.
  webhookEvent: 30,
  /// Failed webhooks are kept longer than processed ones, because the reason
  /// to keep them is diagnosis and diagnosis happens later.
  webhookEventFailed: 90,
  /// Message and discount history. A merchant answering "why did my customer
  /// get this?" is asking about something recent; a year is generous.
  messageLog: 365,
  discountGrant: 365,
  /// Finished journeys.
  terminalEnrollment: 365,
  /// The order mirror. Two years covers the longest realistic winback window
  /// plus a year of comparison.
  order: 730,
  dataAccessLog: 365,
};

/**
 * Enrollment states that will never run another step. Only these are safe to
 * delete, and only these make their messages safe to delete — see below.
 */
const TERMINAL_STATES = ['COMPLETED', 'EXITED', 'CANCELLED', 'FAILED'];

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Delete personal data that has outlived its purpose.
 *
 * Two rules shape everything here.
 *
 * **Suppressions are never purged.** A Suppression row is a person saying "stop
 * emailing me". Deleting it as stale would let the next automation mail them
 * again — the record looks like old data and is actually a standing
 * instruction. It is removed in exactly one case, `customers/redact`, where the
 * person has asked for the record itself to go.
 *
 * **A MessageLog row is the send-once guarantee, not just history.** The unique
 * (shopId, dedupeKey) constraint is what stops a retried step from sending a
 * second copy of the same discount email. Deleting one while its enrollment can
 * still run would remove that protection at exactly the wrong moment, so
 * messages are only purged once their enrollment is terminal or already gone.
 */
export async function purgeExpiredData() {
  const results = {};

  results.webhookEventsProcessed = (
    await prisma.webhookEvent.deleteMany({
      where: { processed: true, createdAt: { lt: daysAgo(RETENTION_DAYS.webhookEvent) } },
    })
  ).count;

  results.webhookEventsFailed = (
    await prisma.webhookEvent.deleteMany({
      where: { processed: false, createdAt: { lt: daysAgo(RETENTION_DAYS.webhookEventFailed) } },
    })
  ).count;

  // Before the enrollments themselves, so the relation filter can still see
  // which state each message belonged to.
  results.messages = (
    await prisma.messageLog.deleteMany({
      where: {
        createdAt: { lt: daysAgo(RETENTION_DAYS.messageLog) },
        OR: [{ enrollmentId: null }, { enrollment: { state: { in: TERMINAL_STATES } } }],
      },
    })
  ).count;

  results.discounts = (
    await prisma.discountGrant.deleteMany({
      where: {
        createdAt: { lt: daysAgo(RETENTION_DAYS.discountGrant) },
        OR: [{ enrollmentId: null }, { enrollment: { state: { in: TERMINAL_STATES } } }],
      },
    })
  ).count;

  // Cascades to StepRun. Any surviving message or discount has its
  // enrollmentId set to null rather than being dragged along.
  results.enrollments = (
    await prisma.enrollment.deleteMany({
      where: {
        state: { in: TERMINAL_STATES },
        enrolledAt: { lt: daysAgo(RETENTION_DAYS.terminalEnrollment) },
      },
    })
  ).count;

  // Cascades to OrderLineItem.
  results.orders = (
    await prisma.order.deleteMany({
      where: { processedAt: { lt: daysAgo(RETENTION_DAYS.order) } },
    })
  ).count;

  results.dataAccessLogs = (
    await prisma.dataAccessLog.deleteMany({
      where: { createdAt: { lt: daysAgo(RETENTION_DAYS.dataAccessLog) } },
    })
  ).count;

  return results;
}
