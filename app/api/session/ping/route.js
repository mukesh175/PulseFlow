import { NextResponse } from 'next/server';
import { requireStore, withStore } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cheap authenticated endpoint used to confirm the embedded session on load.
 * It does no database work beyond resolving the store, so it is safe to call
 * on every page view.
 */
export const GET = withStore(async () => {
  const store = await requireStore();
  return NextResponse.json({ ok: true, shop: store.shopDomain, embedded: true });
});
