import prisma from '@/lib/prisma';
import { shopifyGraphQL } from '@/lib/shopify/client';

const SHOP_QUERY = `
  query ShopProfile {
    shop {
      name
      email
      currencyCode
      ianaTimezone
      billingAddress { countryCodeV2 }
    }
  }
`;

/**
 * One cheap call that gives us currency, timezone and a contact address at
 * install time, so the first render has real values rather than defaults.
 *
 * The timezone matters more here than it did in StorePulse: "send on day 30"
 * has to mean day 30 in the merchant's timezone, not in UTC.
 */
export async function syncShopProfile(store) {
  const data = await shopifyGraphQL(store, SHOP_QUERY);
  const shop = data?.shop;
  if (!shop) return store;

  return prisma.store.update({
    where: { id: store.id },
    data: {
      shopName: shop.name ?? null,
      email: shop.email ?? null,
      currency: shop.currencyCode || store.currency,
      timezone: shop.ianaTimezone || store.timezone,
      countryCode: shop.billingAddress?.countryCodeV2 ?? null,
      lastSyncAt: new Date(),
      lastSyncError: null,
    },
  });
}
