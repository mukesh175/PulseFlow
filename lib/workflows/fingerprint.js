import crypto from 'crypto';

/**
 * Enrollment fingerprint.
 *
 * Adapted from the StorePulse alert engine, where a deterministic hash of
 * `type|resourceId|scope` plus a unique constraint made repeat signals collapse
 * into one row. The same shape solves a sharper problem here: Shopify delivers
 * webhooks at least once, so `orders/create` for a single order can arrive
 * several times. Without a fingerprint each delivery starts another journey and
 * the customer receives the same discount email two or three times.
 *
 * The inputs are the three things that define "this customer, on this workflow,
 * because of this event":
 *
 *   workflowId       — different workflows may legitimately enroll the same
 *                      customer off the same order
 *   customerEmail    — normalised, because Shopify is inconsistent about case
 *   triggerEventId   — the Shopify order/event id, NOT a timestamp: a redelivery
 *                      carries the same id, which is exactly the collision we
 *                      want
 *
 * Deliberately not included: the workflow *version*. Editing a workflow must
 * not make an already-enrolled customer eligible to be enrolled again.
 */
export function enrollmentFingerprint({ workflowId, customerEmail, triggerEventId }) {
  if (!workflowId || !customerEmail || !triggerEventId) {
    throw new Error('enrollmentFingerprint requires workflowId, customerEmail and triggerEventId');
  }

  const parts = [String(workflowId), normalizeEmail(customerEmail), String(triggerEventId)];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/**
 * Lowercase and trim. Address-level canonicalisation (stripping Gmail dots or
 * +tags) is deliberately avoided: two addresses that look equivalent to us may
 * be distinct customers to the merchant, and collapsing them would silently
 * drop someone's email.
 */
export function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}
