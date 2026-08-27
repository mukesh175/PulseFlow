import prisma from '@/lib/prisma';
import { restOrderToRecord, restOrderLineItems } from '@/lib/webhooks/mappers';
import { logPrivacyAction } from '@/lib/audit';
import { enrollFromOrder } from '@/lib/workflows/triggers';
import { recordDiscountUsage } from '@/lib/channels/discount';

/**
 * Record the raw event first. The unique (shopDomain, topic, eventId)
 * constraint makes Shopify's at-least-once delivery harmless: a redelivered
 * webhook is recognised and skipped.
 */
export async function recordEvent({ shopDomain, topic, eventId, payload, shopId }) {
  try {
    return await prisma.webhookEvent.create({
      data: { shopDomain, topic, eventId, payload, shopId: shopId ?? null },
    });
  } catch (error) {
    if (error.code === 'P2002') return null; // already seen
    throw error;
  }
}

async function markProcessed(eventRow, error) {
  if (!eventRow) return;
  try {
    await prisma.webhookEvent.update({
      where: { id: eventRow.id },
      data: {
        processed: !error,
        processedAt: new Date(),
        attempts: { increment: 1 },
        error: error ? String(error.message).slice(0, 500) : null,
      },
    });
  } catch (updateError) {
    // shop/redact deletes the Store, which cascades this very row away.
    // Losing the audit update is expected there and must not fail the webhook.
    if (updateError.code !== 'P2025') throw updateError;
  }
}

// --- topic handlers ----------------------------------------------------------

async function handleOrderUpsert(store, payload) {
  const data = restOrderToRecord(payload, store.currency);

  const order = await prisma.order.upsert({
    where: { shopId_shopifyOrderId: { shopId: store.id, shopifyOrderId: data.shopifyOrderId } },
    create: { ...data, shopId: store.id },
    update: data,
  });

  const lineItems = restOrderLineItems(payload);
  if (lineItems.length) {
    await prisma.orderLineItem.deleteMany({ where: { orderId: order.id } });
    await prisma.orderLineItem.createMany({
      data: lineItems.map((li) => ({ ...li, orderId: order.id })),
    });
  }

  // Runs on updates as well as creates, because a discount can be applied to a
  // draft order that becomes a real one. Matching is on codes we issued, so an
  // unrelated code the merchant created by hand is ignored.
  try {
    await recordDiscountUsage({ store, payload, orderId: order.id });
  } catch (error) {
    console.error('[pulseflow] recording discount usage failed', error);
  }

  return order;
}

/**
 * Only `orders/create` enrolls. `orders/updated` reuses the same upsert, and
 * enrolling from it would put a customer into a workflow again every time the
 * merchant edited a note or added a tag.
 */
async function handleOrderCreate(store, payload) {
  const order = await handleOrderUpsert(store, payload);

  try {
    await enrollFromOrder({ store, payload });
  } catch (error) {
    // The order mirror is the webhook's contract with Shopify; enrollment is
    // ours. Failing the webhook over an enrollment problem would make Shopify
    // retry the whole delivery, and the mirror is already written.
    console.error('[pulseflow] enrollment from order failed', error);
  }

  return order;
}

async function handleRefundCreate(store, payload) {
  const shopifyOrderId = String(payload.order_id);
  const order = await prisma.order.findUnique({
    where: { shopId_shopifyOrderId: { shopId: store.id, shopifyOrderId } },
  });
  if (!order) return null;

  const amount = (payload.transactions || []).reduce((sum, tx) => sum + Number(tx.amount || 0), 0);

  return prisma.order.update({
    where: { id: order.id },
    data: {
      refundedAmount: Number(order.refundedAmount) + amount,
      financialStatus: amount >= Number(order.totalPrice) ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
    },
  });
}

async function handleCustomerUpdate(store, payload) {
  const email = payload?.email?.toLowerCase();
  if (!email) return null;

  // Only the mirrored name is kept in sync here. Consent is not cached as a
  // decision — it is read from Shopify at send time, every time.
  const name = [payload.first_name, payload.last_name].filter(Boolean).join(' ') || null;
  if (!name) return null;

  await prisma.order.updateMany({
    where: { shopId: store.id, customerEmail: email },
    data: { customerName: name },
  });
  return null;
}

async function handleAppUninstalled(store) {
  // Shopify cancels any active subscription on uninstall, so the local plan
  // must be cleared with it — otherwise a reinstall silently restores a paid
  // plan nobody is being charged for.
  await prisma.store.update({
    where: { id: store.id },
    data: {
      uninstalledAt: new Date(),
      accessToken: '',
      refreshToken: null,
      tokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      plan: 'FREE',
      subscriptionId: null,
      subscriptionStatus: null,
      planActivatedAt: null,
    },
  });

  // Stop every journey in flight. Without this, a reinstall three weeks later
  // would resume waits that have long since passed and fire a burst of stale
  // messages at customers.
  await prisma.enrollment.updateMany({
    where: { shopId: store.id, state: { in: ['WAITING', 'RUNNING'] } },
    data: { state: 'CANCELLED', nextRunAt: null, lockedUntil: null, lockedBy: null },
  });

  await prisma.workflow.updateMany({
    where: { shopId: store.id, status: 'ACTIVE' },
    data: { status: 'PAUSED', pausedAt: new Date() },
  });
}

async function handleAppSubscriptionUpdate(store, payload) {
  const subscription = payload?.app_subscription;
  if (!subscription) return null;

  const active = subscription.status === 'ACTIVE';

  return prisma.store.update({
    where: { id: store.id },
    data: {
      subscriptionId: active ? subscription.admin_graphql_api_id ?? null : null,
      subscriptionStatus: subscription.status ?? null,
      planActivatedAt: active ? new Date(subscription.created_at ?? Date.now()) : null,
      // Plan resolution lands with billing in a later phase; the status cache
      // is what the UI needs today.
    },
  });
}

// --- mandatory privacy (GDPR) webhooks ---------------------------------------

async function handleCustomerDataRequest(store, payload) {
  const email = payload?.customer?.email?.toLowerCase();
  if (!email) {
    await logPrivacyAction(store.id, 'DATA_REQUEST', 0, 'customers/data_request with no email');
    return;
  }

  // Unlike StorePulse, this is not a no-op. PulseFlow holds records of messages
  // actually sent to this person and discounts issued to them — data the
  // merchant cannot export from the Shopify admin, so it has to be counted and
  // disclosed here.
  const [orders, messages, discounts, enrollments] = await Promise.all([
    prisma.order.count({ where: { shopId: store.id, customerEmail: email } }),
    prisma.messageLog.count({ where: { shopId: store.id, recipient: email } }),
    prisma.discountGrant.count({ where: { shopId: store.id, enrollment: { customerEmail: email } } }),
    prisma.enrollment.count({ where: { shopId: store.id, customerEmail: email } }),
  ]);

  await logPrivacyAction(
    store.id,
    'DATA_REQUEST',
    orders + messages + discounts + enrollments,
    `orders=${orders} messages=${messages} discounts=${discounts} enrollments=${enrollments}`
  );
}

async function handleCustomerRedact(store, payload) {
  const email = payload?.customer?.email?.toLowerCase();
  if (!email) return;

  let redacted = 0;

  await prisma.$transaction(async (tx) => {
    // Cancel anything in flight before scrubbing the address it would be sent
    // to. Order matters: a journey left WAITING with a nulled recipient would
    // fail noisily in the scheduler forever.
    const cancelled = await tx.enrollment.updateMany({
      where: { shopId: store.id, customerEmail: email, state: { in: ['WAITING', 'RUNNING'] } },
      data: { state: 'CANCELLED', nextRunAt: null, lockedUntil: null, lockedBy: null },
    });

    const orders = await tx.order.updateMany({
      where: { shopId: store.id, customerEmail: email },
      data: { customerEmail: null, customerName: null, shopifyCustomerId: null },
    });

    // Message history is kept but de-identified: the merchant keeps the fact
    // that a send happened, without the address it went to.
    const messages = await tx.messageLog.updateMany({
      where: { shopId: store.id, recipient: email },
      data: { recipient: 'redacted@pulseflow.invalid' },
    });

    await tx.enrollment.updateMany({
      where: { shopId: store.id, customerEmail: email },
      data: { customerEmail: 'redacted@pulseflow.invalid', shopifyCustomerId: null },
    });

    // The suppression row is deleted last. Keeping an opt-out on file is
    // arguably defensible, but it is a record of this person keyed by their
    // email address, and a redaction request asks for exactly that to go.
    await tx.suppression.deleteMany({ where: { shopId: store.id, email } });

    redacted = cancelled.count + orders.count + messages.count;
  });

  await logPrivacyAction(store.id, 'REDACT', redacted, 'customers/redact webhook');
}

async function handleShopRedact(store) {
  // Deleting the store cascades to orders, workflows, enrollments, step runs,
  // messages, discounts, suppressions and webhook events.
  await prisma.store.delete({ where: { id: store.id } });
}

const HANDLERS = {
  'customers/data_request': handleCustomerDataRequest,
  'customers/redact': handleCustomerRedact,
  'shop/redact': handleShopRedact,
  'orders/create': handleOrderCreate,
  'orders/updated': handleOrderUpsert,
  'orders/cancelled': handleOrderUpsert,
  'refunds/create': handleRefundCreate,
  'customers/update': handleCustomerUpdate,
  'app/uninstalled': handleAppUninstalled,
  'app_subscriptions/update': handleAppSubscriptionUpdate,
};

/**
 * Persist then process. Every handler is database-only and short — no Shopify
 * API calls happen inside the webhook request path.
 */
export async function processWebhook({ store, shopDomain, topic, eventId, payload }) {
  const eventRow = await recordEvent({ shopDomain, topic, eventId, payload, shopId: store?.id });

  if (!eventRow) return { duplicate: true };
  if (!store) {
    await markProcessed(eventRow, new Error('Unknown shop'));
    return { ignored: true };
  }

  const handler = HANDLERS[topic];
  if (!handler) {
    await markProcessed(eventRow, null);
    return { unhandled: true };
  }

  try {
    await handler(store, payload);
    await markProcessed(eventRow, null);
    return { ok: true };
  } catch (error) {
    console.error(`[pulseflow] webhook ${topic} failed`, error);
    await markProcessed(eventRow, error);
    return { ok: false, error: error.message };
  }
}
