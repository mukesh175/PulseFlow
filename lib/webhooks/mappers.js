/**
 * Shopify REST webhook payloads → PulseFlow rows.
 *
 * Webhook bodies are REST-shaped even for apps that otherwise use GraphQL, so
 * these read snake_case and emit camelCase. Everything is defensive: a field
 * that is absent must produce null, not throw, because a malformed payload
 * should cost us one order and not the whole webhook.
 */

function decimal(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function date(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function upper(value) {
  return value ? String(value).toUpperCase() : null;
}

export function restOrderToRecord(payload, fallbackCurrency = 'USD') {
  return {
    shopifyOrderId: String(payload.id),
    orderNumber: payload.name ?? (payload.order_number != null ? String(payload.order_number) : null),
    // Guest checkouts have no customer object at all.
    shopifyCustomerId: payload.customer?.id ? String(payload.customer.id) : null,
    customerEmail: (payload.email || payload.customer?.email || null)?.toLowerCase() ?? null,
    customerName:
      [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(' ') || null,
    totalPrice: decimal(payload.total_price),
    currency: payload.currency || fallbackCurrency,
    financialStatus: upper(payload.financial_status),
    fulfillmentStatus: upper(payload.fulfillment_status),
    cancelledAt: date(payload.cancelled_at),
    processedAt: date(payload.processed_at) ?? date(payload.created_at),
  };
}

export function restOrderLineItems(payload) {
  return (payload.line_items || []).map((li) => ({
    shopifyLineItemId: li.id != null ? String(li.id) : null,
    shopifyProductId: li.product_id != null ? String(li.product_id) : null,
    shopifyVariantId: li.variant_id != null ? String(li.variant_id) : null,
    title: li.title || li.name || 'Item',
    quantity: Number(li.quantity) || 1,
    price: decimal(li.price),
  }));
}

/**
 * Is this the customer's first order?
 *
 * Shopify sends `orders_count` on the embedded customer object. It counts the
 * order currently being created, so a first order reports 1. Guests report
 * nothing, and are treated as first-time buyers — which is correct for the
 * post-purchase workflows, and is why the enrollment fingerprint keys on email.
 */
export function isFirstOrder(payload) {
  const count = payload.customer?.orders_count;
  if (count == null) return true;
  return Number(count) <= 1;
}

/**
 * Marketing consent as of this payload.
 *
 * Mirrored for previews and audience counts only. The send path re-reads
 * consent from Shopify at send time, because a customer can withdraw it
 * halfway through a 30-day wait and this mirror would not know.
 */
export function marketingConsentState(customer) {
  return upper(customer?.email_marketing_consent?.state) ?? null;
}
