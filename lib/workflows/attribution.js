import prisma from '@/lib/prisma';

/**
 * Revenue attributed to a workflow.
 *
 * There are two honest ways to connect an order to an automation, and they are
 * not equally strong. Reporting them as one number would overstate what the app
 * knows, so they are counted and shown separately.
 *
 * **Direct** — the order redeemed a code this workflow issued. The link is a
 * fact: the code exists because of the automation, and it was used.
 *
 * **Influenced** — the customer ordered within a window after receiving a
 * message, without using a code. The message may have caused the order, or the
 * customer may have been coming back anyway. It is a correlation, and calling
 * it anything else would let a merchant justify a spend on a number that is
 * partly their own baseline.
 *
 * A merchant deciding whether an automation pays for itself should be able to
 * see the strong number on its own.
 */

/** How long after a message an order still counts as influenced. */
export const INFLUENCE_WINDOW_DAYS = 7;

export async function attributionFor({ shopId, workflowId, days = 90 }) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const [grants, messages] = await Promise.all([
    prisma.discountGrant.findMany({
      where: {
        shopId,
        enrollment: { workflowId },
        usedAt: { not: null, gte: since },
        usedOnOrderId: { not: null },
      },
      select: { usedOnOrderId: true },
    }),
    prisma.messageLog.findMany({
      where: {
        shopId,
        status: 'SENT',
        sentAt: { gte: since },
        enrollment: { workflowId },
      },
      select: { recipient: true, sentAt: true },
    }),
  ]);

  const directOrderIds = [...new Set(grants.map((g) => g.usedOnOrderId))];
  const direct = await sumOrders(shopId, directOrderIds);

  const influenced = await influencedOrders({ shopId, messages, excludeOrderIds: directOrderIds });

  return {
    days,
    windowDays: INFLUENCE_WINDOW_DAYS,
    messagesSent: messages.length,
    direct,
    influenced,
  };
}

async function sumOrders(shopId, orderIds) {
  if (orderIds.length === 0) return { orders: 0, revenue: 0 };

  const rows = await prisma.order.findMany({
    where: { id: { in: orderIds }, shopId, cancelledAt: null },
    select: { totalPrice: true, refundedAmount: true },
  });

  // Net of refunds. A winback that produced an order which was then returned
  // did not produce revenue, and a report that says otherwise is the kind a
  // merchant stops trusting after the first time they check it.
  const revenue = rows.reduce((sum, o) => sum + Number(o.totalPrice) - Number(o.refundedAmount), 0);
  return { orders: rows.length, revenue: round(revenue) };
}

async function influencedOrders({ shopId, messages, excludeOrderIds }) {
  if (messages.length === 0) return { orders: 0, revenue: 0 };

  // Earliest send per recipient: a customer who received three messages should
  // not have one order counted three times.
  const earliest = new Map();
  for (const message of messages) {
    const current = earliest.get(message.recipient);
    if (!current || message.sentAt < current) earliest.set(message.recipient, message.sentAt);
  }

  const recipients = [...earliest.keys()];
  const windowMs = INFLUENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const orders = await prisma.order.findMany({
    where: {
      shopId,
      customerEmail: { in: recipients },
      cancelledAt: null,
      processedAt: { gte: new Date(Math.min(...earliest.values())) },
      id: { notIn: excludeOrderIds.length ? excludeOrderIds : ['__none__'] },
    },
    select: { id: true, customerEmail: true, processedAt: true, totalPrice: true, refundedAmount: true },
  });

  const counted = new Set();
  let revenue = 0;
  let count = 0;

  for (const order of orders) {
    const sentAt = earliest.get(order.customerEmail);
    if (!sentAt || !order.processedAt) continue;

    const delta = order.processedAt.getTime() - sentAt.getTime();
    if (delta < 0 || delta > windowMs) continue;

    // One order counts once, however many messages preceded it.
    if (counted.has(order.id)) continue;
    counted.add(order.id);

    count += 1;
    revenue += Number(order.totalPrice) - Number(order.refundedAmount);
  }

  return { orders: count, revenue: round(revenue) };
}

function round(value) {
  return Math.round(value * 100) / 100;
}
