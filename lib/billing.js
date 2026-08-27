import prisma from '@/lib/prisma';
import { shopifyGraphQL } from '@/lib/shopify/client';

/**
 * Plans and limits.
 *
 * The two things worth metering in this app are how many automations run at
 * once and how many messages leave per month. Both are what actually costs
 * something to serve, and both are numbers a merchant can check against their
 * own expectations before paying.
 *
 * Deliberately not metered: customers enrolled, or orders mirrored. A merchant
 * cannot control how many orders they get, and a plan whose limit moves with a
 * good month punishes exactly the store the app is supposed to help.
 */

export const BILLING_ENABLED = process.env.BILLING_ENABLED !== 'false';

export const PLAN_ORDER = ['FREE', 'STARTER', 'GROWTH', 'PRO'];

export const PLANS = {
  FREE: {
    id: 'FREE',
    name: 'Free',
    price: 0,
    activeWorkflows: 1,
    messagesPerMonth: 100,
    highlights: ['One active automation', '100 messages a month', 'Full history and previews'],
  },
  STARTER: {
    id: 'STARTER',
    name: 'Starter',
    price: 19,
    activeWorkflows: 5,
    messagesPerMonth: 1000,
    highlights: ['Five active automations', '1,000 messages a month'],
  },
  GROWTH: {
    id: 'GROWTH',
    name: 'Growth',
    price: 49,
    activeWorkflows: 20,
    messagesPerMonth: 10000,
    highlights: ['Twenty active automations', '10,000 messages a month'],
  },
  PRO: {
    id: 'PRO',
    name: 'Pro',
    price: 99,
    activeWorkflows: null,
    messagesPerMonth: null,
    highlights: ['Unlimited automations', 'Unlimited messages'],
  },
};

export function planFor(store) {
  return PLANS[store?.plan] ?? PLANS.FREE;
}

/** Calendar month, because it is the window a merchant can check for themselves. */
export function currentPeriodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * What the store has used this month.
 *
 * Only SENT counts. A message skipped for consent or an unsubscribe never left,
 * and charging a merchant's quota for a message the app refused to send on
 * their behalf would be indefensible.
 */
export async function usageFor(store, now = new Date()) {
  const plan = planFor(store);
  const since = currentPeriodStart(now);

  const [messagesSent, activeWorkflows] = await Promise.all([
    prisma.messageLog.count({
      where: { shopId: store.id, status: 'SENT', sentAt: { gte: since } },
    }),
    prisma.workflow.count({ where: { shopId: store.id, status: 'ACTIVE' } }),
  ]);

  return {
    plan,
    periodStart: since,
    messagesSent,
    messagesLimit: plan.messagesPerMonth,
    messagesRemaining: plan.messagesPerMonth === null ? null : Math.max(0, plan.messagesPerMonth - messagesSent),
    activeWorkflows,
    workflowLimit: plan.activeWorkflows,
  };
}

/**
 * May this store activate another automation?
 *
 * Checked at activation rather than at creation: drafting and previewing cost
 * nothing, and a merchant should be able to build and compare several before
 * choosing which one to run.
 */
export async function canActivateWorkflow(store) {
  if (!BILLING_ENABLED) return { allowed: true };

  const plan = planFor(store);
  if (plan.activeWorkflows === null) return { allowed: true };

  const active = await prisma.workflow.count({ where: { shopId: store.id, status: 'ACTIVE' } });
  if (active < plan.activeWorkflows) return { allowed: true };

  return {
    allowed: false,
    reason: `The ${plan.name} plan runs ${plan.activeWorkflows} automation${plan.activeWorkflows === 1 ? '' : 's'} at a time. Pause one, or move to a larger plan.`,
  };
}

/**
 * May this store enroll another customer?
 *
 * The quota is enforced here — at the door — rather than at the moment of
 * sending. A journey that starts and then stops halfway leaves one customer
 * with the first email of a conversation and never the second, which is worse
 * for them than never having been enrolled. So a store over its limit stops
 * taking new people, and everyone already inside finishes.
 */
export async function canEnroll(store, now = new Date()) {
  if (!BILLING_ENABLED) return { allowed: true };

  const plan = planFor(store);
  if (plan.messagesPerMonth === null) return { allowed: true };

  const sent = await prisma.messageLog.count({
    where: { shopId: store.id, status: 'SENT', sentAt: { gte: currentPeriodStart(now) } },
  });

  if (sent < plan.messagesPerMonth) return { allowed: true };

  return {
    allowed: false,
    reason: `${plan.name} includes ${plan.messagesPerMonth.toLocaleString()} messages a month, and this month is used up. Customers already partway through an automation will still finish.`,
  };
}

// ---------------------------------------------------------------------------
// Shopify Billing API
// ---------------------------------------------------------------------------

const ACTIVE_SUBSCRIPTIONS = `
  query ActiveSubscriptions {
    currentAppInstallation {
      activeSubscriptions { id name status test createdAt }
    }
  }
`;

/**
 * PulseFlow uses **Shopify App Pricing** (managed pricing): plans are declared
 * in the Partner Dashboard and Shopify owns the whole purchase flow.
 *
 * `appSubscriptionCreate` is rejected outright in that mode, so an upgrade
 * sends the merchant to Shopify's own plan page. Shopify then handles approval,
 * decline, cancellation and re-approval after a reinstall — which is what app
 * review expects, and considerably less to get wrong than doing it ourselves.
 */
export function managedPricingUrl(store) {
  const handle = process.env.SHOPIFY_APP_HANDLE || 'pulseflow-automations';
  const storeHandle = String(store.shopDomain).replace('.myshopify.com', '');
  return `https://admin.shopify.com/store/${storeHandle}/charges/${handle}/pricing_plans`;
}

/** Shopify is the source of truth; this reconciles our cached plan with it. */
export async function syncSubscriptionState(store) {
  const data = await shopifyGraphQL(store, ACTIVE_SUBSCRIPTIONS);
  const active = data?.currentAppInstallation?.activeSubscriptions ?? [];
  const current = active.find((s) => s.status === 'ACTIVE') ?? null;

  const updated = await prisma.store.update({
    where: { id: store.id },
    data: {
      plan: current ? planIdFromSubscriptionName(current.name) : 'FREE',
      subscriptionId: current?.id ?? null,
      subscriptionStatus: current?.status ?? null,
      planActivatedAt: current ? new Date(current.createdAt) : null,
    },
  });

  return { store: updated, subscription: current };
}

export function planIdFromSubscriptionName(name) {
  const upper = String(name ?? '').toUpperCase();
  // Longest name first, so "Growth" cannot be matched by a shorter plan whose
  // name happens to be a substring of it.
  const match = [...PLAN_ORDER]
    .sort((a, b) => PLANS[b].name.length - PLANS[a].name.length)
    .find((id) => PLANS[id].price > 0 && upper.includes(PLANS[id].name.toUpperCase()));
  return match ?? 'FREE';
}
