import prisma from '@/lib/prisma';
import { enrollCustomer } from '@/lib/workflows/enroll';
import { isFirstOrder } from '@/lib/webhooks/mappers';

/**
 * Turning an order into enrollments.
 *
 * Called from the `orders/create` webhook handler, which means it runs inside
 * the webhook request and must stay database-only and quick. It enrolls; it
 * never executes a step. The first step runs on the next sweep, so a slow or
 * broken workflow cannot make Shopify's webhook time out and retry — which
 * would turn one order into a stream of them.
 */

/**
 * Does this workflow's trigger match this order?
 *
 * Kept as a pure function of the definition and the payload so the preview can
 * ask the same question about historical orders and get the same answer. If
 * these two ever disagree, the preview lies about what will happen.
 */
export function triggerMatchesOrder(definition, { firstOrder }) {
  const trigger = definition?.trigger;
  if (!trigger || trigger.type !== 'order_created') return false;
  if (trigger.firstOrderOnly && !firstOrder) return false;
  return true;
}

/**
 * Enroll a new order's customer into every active workflow that wants them.
 *
 * Returns a summary rather than throwing: one workflow failing to enroll should
 * not stop the others, and must never fail the webhook.
 */
export async function enrollFromOrder({ store, payload, now = new Date() }) {
  const email = (payload.email || payload.customer?.email || '').trim().toLowerCase();

  // Guest checkouts without an email cannot be enrolled: there is nobody to
  // send to, and the fingerprint has no identity to key on.
  if (!email) return { enrolled: 0, skipped: 'no customer email' };

  const workflows = await prisma.workflow.findMany({
    where: { shopId: store.id, status: 'ACTIVE' },
  });

  if (workflows.length === 0) return { enrolled: 0 };

  const firstOrder = isFirstOrder(payload);
  // The Shopify order id, not a timestamp: a redelivered webhook carries the
  // same id, which is exactly the collision the fingerprint needs to see.
  const triggerEventId = String(payload.id);

  let enrolled = 0;
  let deduped = 0;

  for (const workflow of workflows) {
    if (!triggerMatchesOrder(workflow.definition, { firstOrder })) continue;

    try {
      const { created } = await enrollCustomer({
        workflow,
        customerEmail: email,
        shopifyCustomerId: payload.customer?.id ? String(payload.customer.id) : null,
        triggerEventId,
        now,
      });
      if (created) enrolled += 1;
      else deduped += 1;
    } catch (error) {
      console.error(`[pulseflow] enrollment into ${workflow.id} failed`, error);
    }
  }

  return { enrolled, deduped };
}
