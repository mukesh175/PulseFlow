import prisma from '@/lib/prisma';
import { syncShopProfile } from '@/lib/sync';
import { registerWebhooks } from '@/lib/shopify/webhooks';
import { backfillOrders } from '@/lib/sync/orders';
import { syncSubscriptionState } from '@/lib/billing';

/**
 * Everything an install needs beyond holding a token.
 *
 * There are two ways a store arrives:
 *
 *   - the OAuth callback, when the merchant clicks through the consent screen
 *   - token exchange in `lib/session.js`, under Shopify managed installation,
 *     where access is granted without our callback ever being hit
 *
 * Managed installation is the default path now, so anything that lives only in
 * the callback effectively does not run. Both paths call this instead.
 *
 * Idempotent and cheap to re-enter: each step is guarded by its own marker, so
 * once both are set this is two field reads and no network. A step that failed
 * last time is retried on the next request rather than being lost.
 */
export async function finalizeInstall(store) {
  let current = store;

  if (!current.lastSyncAt) {
    try {
      // Currency and timezone come from here. Timezone especially matters:
      // "send 30 days after the order" has to mean 30 days in the merchant's
      // timezone, and the schema default of UTC is a guess, not an answer.
      current = await syncShopProfile(current);
    } catch (error) {
      console.error('[pulseflow] shop profile sync failed', error);
      current = await recordSyncError(current, error);
    }
  }

  if (!current.ordersBackfilledAt) {
    try {
      // Bounded so a busy store cannot hold up the page render that triggered
      // this. An incomplete run leaves the marker unset and resumes next time;
      // every write is an idempotent upsert, so resuming re-does at most a page.
      const result = await backfillOrders(current, { deadline: Date.now() + 20_000 });
      current = await prisma.store.findUnique({ where: { id: current.id } });
      if (!result.complete) {
        console.warn(`[pulseflow] order backfill incomplete: ${result.written}/${result.found}`);
      }
    } catch (error) {
      console.error('[pulseflow] order backfill failed', error);
      current = await recordSyncError(current, error);
    }
  }

  if (!current.webhooksRegisteredAt) {
    try {
      const { failures } = await registerWebhooks(current);
      // Only claim success when every topic registered. A partial result left
      // unmarked is retried; marked, it would be forgotten.
      if (!failures.length) {
        current = await prisma.store.update({
          where: { id: current.id },
          data: { webhooksRegisteredAt: new Date() },
        });
      }
    } catch (error) {
      console.error('[pulseflow] webhook registration failed', error);
    }
  }

  // Shopify cancels a subscription on uninstall, so a reinstalling merchant
  // starts on FREE. Reconciling here re-grants a plan only if Shopify says one
  // is genuinely active — it never restores a plan nobody is paying for.
  try {
    await syncSubscriptionState(current);
    current = await prisma.store.findUnique({ where: { id: current.id } });
  } catch (error) {
    console.error('[pulseflow] subscription reconciliation failed', error);
  }

  return current;
}

async function recordSyncError(store, error) {
  try {
    return await prisma.store.update({
      where: { id: store.id },
      data: { lastSyncError: String(error.message).slice(0, 500) },
    });
  } catch {
    return store;
  }
}
