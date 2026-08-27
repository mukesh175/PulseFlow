import prisma from '@/lib/prisma';
import { paginate } from '@/lib/shopify/client';
import { logPrivacyAction } from '@/lib/audit';

/**
 * Backfill historical orders.
 *
 * Without this the mirror only ever holds orders that arrived by webhook since
 * install, so a merchant's very first preview says "0 customers would have
 * entered" no matter how many orders their store has. The preview is the brief's
 * safety step — draft, preview, activate — and a preview that reports zero for
 * everyone is not a safety step, it is a reason to distrust the app in the first
 * five minutes.
 *
 * **This never enrolls anyone.** Backfilled orders populate the mirror for
 * previews, first-order detection and revenue attribution. Enrollment happens
 * only from a live `orders/create` webhook. If a backfill enrolled, activating a
 * workflow would immediately mail ninety days of past customers — the exact
 * failure the activation confirmation exists to prevent.
 */

const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        processedAt
        createdAt
        cancelledAt
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        totalRefundedSet { shopMoney { amount } }
        discountApplications(first: 10) {
          nodes { ... on DiscountCodeApplication { code } }
        }
        customer { id firstName lastName email }
        lineItems(first: 50) {
          nodes {
            id
            title
            quantity
            originalUnitPriceSet { shopMoney { amount } }
            product { id }
            variant { id }
          }
        }
      }
    }
  }
`;

/** How far back a first sync reaches. */
export const BACKFILL_DAYS = 90;

/** Ceiling per run, so one store cannot monopolise a serverless invocation. */
const MAX_ORDERS = 500;

function gidToId(gid) {
  if (!gid) return null;
  const parts = String(gid).split('/');
  return parts[parts.length - 1] || null;
}

function decimal(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function mapOrder(node, fallbackCurrency) {
  const customer = node.customer;
  const name = [customer?.firstName, customer?.lastName].filter(Boolean).join(' ');

  return {
    shopifyOrderId: gidToId(node.id),
    orderNumber: node.name ?? null,
    shopifyCustomerId: gidToId(customer?.id),
    customerEmail: customer?.email?.toLowerCase() ?? null,
    customerName: name || null,
    totalPrice: decimal(node.currentTotalPriceSet?.shopMoney?.amount),
    refundedAmount: decimal(node.totalRefundedSet?.shopMoney?.amount),
    currency: node.currentTotalPriceSet?.shopMoney?.currencyCode || fallbackCurrency,
    financialStatus: node.displayFinancialStatus ?? null,
    fulfillmentStatus: node.displayFulfillmentStatus ?? null,
    cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
    processedAt: node.processedAt ? new Date(node.processedAt) : new Date(node.createdAt),
  };
}

async function upsertOrder(store, node) {
  const data = mapOrder(node, store.currency);
  if (!data.shopifyOrderId) return null;

  const order = await prisma.order.upsert({
    where: { shopId_shopifyOrderId: { shopId: store.id, shopifyOrderId: data.shopifyOrderId } },
    create: { ...data, shopId: store.id },
    update: data,
  });

  const lineItems = node.lineItems?.nodes ?? [];
  if (lineItems.length) {
    await prisma.orderLineItem.deleteMany({ where: { orderId: order.id } });
    await prisma.orderLineItem.createMany({
      data: lineItems.map((li) => ({
        orderId: order.id,
        shopifyLineItemId: gidToId(li.id),
        shopifyProductId: gidToId(li.product?.id),
        shopifyVariantId: gidToId(li.variant?.id),
        title: li.title || 'Item',
        quantity: Number(li.quantity ?? 1),
        price: decimal(li.originalUnitPriceSet?.shopMoney?.amount),
      })),
    });
  }

  return order;
}

/**
 * `deadline` is an epoch-ms budget. Each write is a round trip to the database,
 * so a busy store cannot finish inside one serverless invocation. Rather than
 * being killed mid-write, stop cleanly and report `complete: false` — every
 * write is an idempotent upsert, so resuming re-does at most one page.
 */
const outOfTime = (deadline) => deadline && Date.now() > deadline;

export async function backfillOrders(store, { days = BACKFILL_DAYS, max = MAX_ORDERS, deadline = null } = {}) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const nodes = await paginate(
    store,
    ORDERS_QUERY,
    { query: `processed_at:>='${since}'` },
    (data) => data?.orders,
    { max, pageSize: 100 }
  );

  let written = 0;
  for (const node of nodes) {
    if (outOfTime(deadline)) break;
    await upsertOrder(store, node);
    written += 1;
  }

  // Orders carry customer names and email addresses, so importing them is an
  // access the privacy policy says is recorded.
  if (written > 0) {
    await logPrivacyAction(store.id, 'ORDER_IMPORT', written, `system: backfill over ${days} days`);
  }

  const complete = written === nodes.length;

  await prisma.store.update({
    where: { id: store.id },
    data: {
      lastSyncAt: new Date(),
      lastSyncError: null,
      ordersBackfilledAt: complete ? new Date() : null,
    },
  });

  return { written, found: nodes.length, complete, days };
}
