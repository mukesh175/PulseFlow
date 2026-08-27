import { env } from '@/lib/env';
import { shopifyGraphQL } from '@/lib/shopify/client';

/**
 * Topics PulseFlow subscribes to at install time.
 *
 * The mandatory privacy topics (customers/data_request, customers/redact,
 * shop/redact) are declared in shopify.app.toml instead — Shopify manages
 * those itself and rejects attempts to register them through the API.
 *
 * Deliberately narrow. Every topic here either feeds the order mirror or keeps
 * local state honest; PulseFlow has no reason to watch inventory the way a
 * monitoring app does.
 */
export const WEBHOOK_TOPICS = [
  'ORDERS_CREATE',
  'ORDERS_UPDATED',
  'ORDERS_CANCELLED',
  'REFUNDS_CREATE',
  // Marketing consent changes arrive here. Consent is still re-checked at send
  // time — this only keeps the mirror current for previews and audience counts.
  'CUSTOMERS_UPDATE',
  'APP_UNINSTALLED',
  'APP_SUBSCRIPTIONS_UPDATE',
];

const LIST_QUERY = `
  query WebhookSubscriptions {
    webhookSubscriptions(first: 50) {
      nodes {
        id
        topic
        endpoint { ... on WebhookHttpEndpoint { callbackUrl } }
      }
    }
  }
`;

const CREATE_MUTATION = `
  mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
    webhookSubscriptionCreate(
      topic: $topic
      webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }
    ) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

function callbackUrlFor(topic) {
  // One endpoint per topic keeps the route readable and lets Shopify's own
  // dashboard show which topic is failing.
  return `${env.appUrl}/api/webhooks/${topic.toLowerCase().replace(/_/g, '-')}`;
}

/**
 * Register every topic that is missing or pointing at a stale URL.
 *
 * Idempotent: safe to call on every install and reinstall. Failures are
 * collected rather than thrown, because a webhook that did not register should
 * not fail the whole installation — the merchant is mid-flow and can be
 * repaired by a later call.
 */
export async function registerWebhooks(store) {
  const existing = await shopifyGraphQL(store, LIST_QUERY);
  const byTopic = new Map(
    (existing?.webhookSubscriptions?.nodes ?? []).map((node) => [node.topic, node.endpoint?.callbackUrl])
  );

  const failures = [];

  for (const topic of WEBHOOK_TOPICS) {
    const callbackUrl = callbackUrlFor(topic);
    if (byTopic.get(topic) === callbackUrl) continue;

    try {
      const result = await shopifyGraphQL(store, CREATE_MUTATION, { topic, callbackUrl });
      const errors = result?.webhookSubscriptionCreate?.userErrors ?? [];
      // "already taken" means a subscription for this topic and URL exists —
      // the desired end state, so not a failure.
      const real = errors.filter((e) => !/already/i.test(e.message ?? ''));
      if (real.length) failures.push(`${topic}: ${real.map((e) => e.message).join(', ')}`);
    } catch (error) {
      failures.push(`${topic}: ${error.message}`);
    }
  }

  if (failures.length) console.error('[pulseflow] webhook registration issues', failures);
  return { registered: WEBHOOK_TOPICS.length - failures.length, failures };
}
