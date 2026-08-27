import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { shopifyGraphQL } from '@/lib/shopify/client';

/**
 * Real Shopify discount codes.
 *
 * Two properties matter, and both are about the code not escaping the person it
 * was meant for:
 *
 * **Locked to one customer where possible.** A code emailed to one person ends
 * up on a coupon site within hours if it is not restricted. Where we know the
 * Shopify customer id, the discount is created for that customer only. Guest
 * checkouts have no customer record, so those fall back to an unrestricted code
 * with a usage limit of one — weaker, and the only option available.
 *
 * **Used exactly once.** `usageLimit: 1` and `appliesOncePerCustomer` together
 * mean a forwarded code cannot become a second discount the merchant did not
 * agree to give.
 */

const CREATE_MUTATION = `
  mutation CreateDiscount($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode { id }
      userErrors { field code message }
    }
  }
`;

const DEACTIVATE_MUTATION = `
  mutation DeactivateDiscount($id: ID!) {
    discountCodeDeactivate(id: $id) {
      userErrors { field message }
    }
  }
`;

/**
 * Human-readable and unguessable at the same time.
 *
 * A customer has to type or recognise this, so it avoids the characters people
 * confuse — no O/0, no I/1 — while keeping enough entropy that a code cannot be
 * found by trying neighbours of a known one.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(prefix = 'PF') {
  const bytes = crypto.randomBytes(8);
  const body = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
  return `${prefix}-${body}`;
}

/** Retry on the vanishingly unlikely collision rather than failing a journey. */
async function reserveCode(shopId, prefix) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode(prefix);
    const clash = await prisma.discountGrant.findUnique({
      where: { shopId_code: { shopId, code } },
      select: { id: true },
    });
    if (!clash) return code;
  }
  throw new Error('Could not allocate an unused discount code');
}

export function createShopifyDiscountChannel() {
  return { createDiscount };
}

async function createDiscount({ store, percentage, amount, title, expiresAt, shopifyCustomerId }) {
  const code = await reserveCode(store.id, 'PF');
  const startsAt = new Date().toISOString();

  const customerSelection = shopifyCustomerId
    ? { customers: { add: [toCustomerGid(shopifyCustomerId)] } }
    : { all: true };

  const value = percentage
    ? // Shopify takes a fraction, not a percentage. Sending 10 here would be a
      // 1000% discount, which the API accepts.
      { percentage: percentage / 100 }
    : { discountAmount: { amount: String(amount), appliesOnEachItem: false } };

  const input = {
    title: title || `PulseFlow automation — ${code}`,
    code,
    startsAt,
    endsAt: expiresAt ? expiresAt.toISOString() : null,
    customerSelection,
    customerGets: { value, items: { all: true } },
    appliesOncePerCustomer: true,
    usageLimit: 1,
  };

  const data = await shopifyGraphQL(store, CREATE_MUTATION, { basicCodeDiscount: input });
  const result = data?.discountCodeBasicCreate;
  const errors = result?.userErrors ?? [];

  if (errors.length) {
    throw new Error(`Shopify refused the discount: ${errors.map((e) => e.message).join('; ')}`);
  }

  const id = result?.codeDiscountNode?.id;
  if (!id) throw new Error('Shopify accepted the discount but returned no id');

  return { code, shopifyDiscountId: id };
}

function toCustomerGid(id) {
  return String(id).startsWith('gid://') ? String(id) : `gid://shopify/Customer/${id}`;
}

/**
 * Turn off a code that should no longer work — an unsubscribe mid-journey, a
 * cancelled enrollment. Failing to deactivate is logged rather than thrown:
 * a code left live is a small commercial cost, while failing the operation that
 * asked for it is a larger one.
 */
export async function deactivateDiscount(store, grant) {
  if (!grant.shopifyDiscountId) return false;

  try {
    const data = await shopifyGraphQL(store, DEACTIVATE_MUTATION, { id: grant.shopifyDiscountId });
    const errors = data?.discountCodeDeactivate?.userErrors ?? [];
    if (errors.length) {
      console.error('[pulseflow] discount deactivate errors', errors);
      return false;
    }
    await prisma.discountGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    return true;
  } catch (error) {
    console.error('[pulseflow] discount deactivate failed', error);
    return false;
  }
}

/**
 * Mark grants used when an order arrives carrying their code.
 *
 * This is what makes the `discount_unused` condition mean anything — without
 * it, every reminder step would fire at every customer, including the ones who
 * already redeemed. It is also the seed of revenue attribution: the order that
 * used the code is recorded against the grant.
 */
export async function recordDiscountUsage({ store, payload, orderId }) {
  const codes = (payload.discount_codes || [])
    .map((d) => (typeof d === 'string' ? d : d?.code))
    .filter(Boolean);

  if (codes.length === 0) return 0;

  const { count } = await prisma.discountGrant.updateMany({
    where: {
      shopId: store.id,
      code: { in: codes },
      usedAt: null,
    },
    data: { usedAt: new Date(payload.processed_at ?? payload.created_at ?? Date.now()), usedOnOrderId: orderId },
  });

  return count;
}
