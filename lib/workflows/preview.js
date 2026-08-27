import prisma from '@/lib/prisma';
import { triggerMatchesOrder } from '@/lib/workflows/triggers';
import { validateWorkflowDefinition } from '@/lib/workflows/schema';

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
    steps: describeSteps(definition),
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

/**
 * A plain-language reading of the definition.
 *
 * The merchant is about to let this send real messages, so the preview shows
 * what it will do in the same words the brief uses, not as JSON.
 */
function describeSteps(definition) {
  return definition.steps.map((step) => {
    switch (step.type) {
      case 'wait':
        return `Wait ${step.days} day${step.days === 1 ? '' : 's'}`;
      case 'condition':
        return step.check === 'has_not_ordered_since_enrollment'
          ? 'Only continue if they have not ordered again'
          : 'Only continue if the discount is still unused';
      case 'send_email':
        return `Send an email — "${step.subject}"`;
      case 'create_discount':
        return step.percentage
          ? `Create a ${step.percentage}% discount, valid ${step.expiresInDays} days`
          : `Create a ${step.amount} off discount, valid ${step.expiresInDays} days`;
      default:
        return step.type;
    }
  });
}

/** Enough to recognise a customer, not enough to be a customer list. */
function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '•••';
  const head = local.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
