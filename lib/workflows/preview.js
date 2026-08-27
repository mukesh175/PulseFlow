import prisma from '@/lib/prisma';
import { triggerMatchesOrder } from '@/lib/workflows/triggers';
import { validateWorkflowDefinition } from '@/lib/workflows/schema';
import { describeDefinition } from '@/lib/workflows/describe';
import { logCustomerDataAccess } from '@/lib/audit';

/**
 * The dry-run preview.
 *
 * Answers "if this had been active, who would it have reached?" against real
 * historical orders, before the merchant activates anything. This is the second
 * half of the brief's safety rule: draft, then preview, then activate. A number
 * a merchant recognises — or one they do not — is what turns activation from a
 * leap into a decision.
 *
 * It reuses `triggerMatchesOrder`, the same function the live webhook path
 * calls. Reimplementing the matching here would produce a preview that
 * gradually stopped describing the thing it previews.
 */

export const DEFAULT_PREVIEW_DAYS = 30;

export async function previewWorkflow({ shopId, definition, days = DEFAULT_PREVIEW_DAYS, sampleSize = 5 }) {
  const { valid, errors } = validateWorkflowDefinition(definition);
  if (!valid) return { valid: false, errors };

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: {
      shopId,
      processedAt: { gte: since },
      cancelledAt: null,
      customerEmail: { not: null },
    },
    orderBy: { processedAt: 'desc' },
    select: {
      shopifyOrderId: true,
      customerEmail: true,
      customerName: true,
      processedAt: true,
      shopifyCustomerId: true,
    },
  });

  // "First order" has to be derived from the mirror rather than read off the
  // payload, because the payload is not available for a historical order. The
  // mirror only holds what has been synced, so a customer whose first order
  // predates the sync window can look like a first-time buyer here. That is a
  // real limitation, and it is surfaced rather than hidden.
  const earliest = await earliestOrderPerCustomer(shopId, orders.map((o) => o.customerEmail));

  const matched = [];
  const seen = new Set();

  for (const order of orders) {
    const firstOrder = isFirstOrderInMirror(order, earliest);
    if (!triggerMatchesOrder(definition, { firstOrder })) continue;

    // One enrollment per customer per trigger event, but for a headline number
    // the merchant is asking "how many people", so distinct customers.
    if (seen.has(order.customerEmail)) continue;
    seen.add(order.customerEmail);
    matched.push(order);
  }

  const oldestSynced = await prisma.order.findFirst({
    where: { shopId },
    orderBy: { processedAt: 'asc' },
    select: { processedAt: true },
  });

  // The one screen where a merchant sees customer names and addresses, so it is
  // the read the privacy policy's "a merchant viewing a screen" refers to.
  // Counted on orders read, not on the sample shown: the app looked at all of
  // them, and logging only what was displayed would understate the access.
  await logCustomerDataAccess({
    shopId,
    action: 'PREVIEW',
    recordCount: orders.length,
    detail: `workflow preview over ${days} days`,
  });

  return {
    valid: true,
    days,
    customers: matched.length,
    ordersConsidered: orders.length,
    sample: matched.slice(0, sampleSize).map((o) => ({
      email: maskEmail(o.customerEmail),
      name: o.customerName,
      orderedAt: o.processedAt,
    })),
    steps: describeDefinition(definition),
    // Without this a merchant reads "3 customers" as a fact about their store,
    // when it may be a fact about how much history has been synced.
    coverage: {
      oldestSyncedOrder: oldestSynced?.processedAt ?? null,
      firstOrderDetectionIsApproximate: !oldestSynced || oldestSynced.processedAt > since,
    },
  };
}

async function earliestOrderPerCustomer(shopId, emails) {
  if (emails.length === 0) return new Map();

  const rows = await prisma.order.groupBy({
    by: ['customerEmail'],
    where: { shopId, customerEmail: { in: [...new Set(emails)] }, cancelledAt: null },
    _min: { processedAt: true },
  });

  return new Map(rows.map((r) => [r.customerEmail, r._min.processedAt]));
}

function isFirstOrderInMirror(order, earliest) {
  const first = earliest.get(order.customerEmail);
  if (!first || !order.processedAt) return true;
  return first.getTime() === order.processedAt.getTime();
}

/** Enough to recognise a customer, not enough to be a customer list. */
function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
