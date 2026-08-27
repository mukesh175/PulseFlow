import crypto from 'crypto';

/**
 * The side-effect boundary.
 *
 * Everything the executor does to the outside world goes through this
 * interface: sending an email, creating a discount. Keeping it narrow is what
 * lets the engine be tested end to end without a real inbox or a real store,
 * and it is where the real implementations land in phases 4 and 5.
 *
 * The brief asks for the channel interface to be designed so WhatsApp can be
 * added later without reshaping anything. That is why `sendEmail` takes a
 * recipient and content rather than a Resend-shaped payload.
 *
 * An implementation must provide:
 *
 *   sendEmail({ store, recipient, subject, body, preheader, enrollmentId })
 *     → { status: 'SENT' | 'SKIPPED' | 'FAILED', providerMessageId?, skipReason?, error? }
 *
 *   createDiscount({ store, percentage, amount, title, expiresAt, customerEmail, enrollmentId })
 *     → { code, shopifyDiscountId? }
 *
 * `SKIPPED` is a first-class outcome, not an error. Consent withdrawn or an
 * unsubscribe means this person should not receive this message — the journey
 * continues and the reason is recorded, because "why didn't my customer get
 * this?" is a question a merchant will ask.
 */

/**
 * Records what would have happened without touching anyone.
 *
 * Used by the end-to-end harness, and by the dry-run preview the brief calls
 * for in phase 3 ("this would have matched 84 customers last month"). Real
 * customers cannot be reached through it, which is the point: for as long as
 * the engine is the thing under test, the safe implementation should be the
 * easy one to reach for.
 */
export function createDryRunChannels({ onEvent } = {}) {
  const events = [];

  const record = (event) => {
    events.push(event);
    if (onEvent) onEvent(event);
  };

  return {
    events,

    async sendEmail({ recipient, subject, enrollmentId }) {
      record({ type: 'email', recipient, subject, enrollmentId });
      return {
        status: 'SKIPPED',
        skipReason: 'dry_run',
        providerMessageId: null,
      };
    },

    async createDiscount({ percentage, amount, expiresAt, enrollmentId }) {
      // Shaped like a real code so anything that displays or matches on it
      // behaves the same as it will in production.
      const code = `PF-DRYRUN-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      record({ type: 'discount', code, percentage, amount, expiresAt, enrollmentId });
      return { code, shopifyDiscountId: null };
    },
  };
}
