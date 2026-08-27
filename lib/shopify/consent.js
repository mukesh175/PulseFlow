import { shopifyGraphQL } from '@/lib/shopify/client';
import { logPrivacyAction } from '@/lib/audit';

/**
 * Marketing consent, read from Shopify at the moment of sending.
 *
 * The brief is explicit that this must not be checked at enrollment: a customer
 * can withdraw consent during a thirty-day wait, and a cached answer from the
 * day they ordered would send to someone who has since said no. So this is a
 * live call on the send path, not a lookup in our mirror — the mirror exists
 * for previews and audience counts, and is deliberately not trusted here.
 *
 * The cost is one API call per send. That is the right trade: the alternative
 * saves a round trip and emails people who opted out.
 */

const CONSENT_QUERY = `
  query CustomerConsent($query: String!) {
    customers(first: 1, query: $query) {
      nodes {
        id
        email
        emailMarketingConsent {
          marketingState
          marketingOptInLevel
          consentUpdatedAt
        }
      }
    }
  }
`;

/**
 * Returns `{ allowed, state, reason }`.
 *
 * Everything that is not an explicit SUBSCRIBED is a refusal. That includes the
 * cases where we simply do not know — a guest checkout with no customer record,
 * a lookup that failed, a redacted customer. Defaulting to "send" when the
 * answer is unclear is how an app ends up mailing people who never agreed.
 */
export async function checkMarketingConsent(store, email) {
  let data;
  try {
    // Escaping matters: an address containing a quote would otherwise break out
    // of the search string and change which customer is matched.
    const escaped = String(email).replace(/["\\]/g, '\\$&');
    data = await shopifyGraphQL(store, CONSENT_QUERY, { query: `email:"${escaped}"` });
  } catch (error) {
    console.error('[pulseflow] consent lookup failed', error);
    return { allowed: false, state: null, reason: 'consent_lookup_failed' };
  }

  const customer = data?.customers?.nodes?.[0];

  // Reading a customer record is an access to protected customer data, and the
  // privacy policy says these are logged. One row per send is the honest cost
  // of that claim.
  await logPrivacyAction(store.id, 'CONSENT_CHECK', customer ? 1 : 0, 'send-time marketing consent');

  if (!customer) {
    return { allowed: false, state: null, reason: 'no_customer_record' };
  }

  const state = customer.emailMarketingConsent?.marketingState ?? null;

  if (state !== 'SUBSCRIBED') {
    return { allowed: false, state, reason: `consent_${String(state ?? 'unknown').toLowerCase()}` };
  }

  return { allowed: true, state, reason: null };
}
