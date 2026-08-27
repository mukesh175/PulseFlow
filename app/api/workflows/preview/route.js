import { NextResponse } from 'next/server';
import { requireStore, withStore } from '@/lib/api';
import { previewWorkflow, DEFAULT_PREVIEW_DAYS } from '@/lib/workflows/preview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Preview a definition against real historical orders.
 *
 * Takes a definition rather than a workflow id, so a merchant can see the
 * answer while still editing and before anything is saved. Nothing is written
 * and nothing is sent — this reads orders and counts.
 */
export const POST = withStore(async (request) => {
  const store = await requireStore();

  const body = await request.json().catch(() => null);
  if (!body?.definition) {
    return NextResponse.json({ error: 'A definition is required.' }, { status: 400 });
  }

  const days = Number.isInteger(body.days) && body.days > 0 && body.days <= 365 ? body.days : DEFAULT_PREVIEW_DAYS;

  const result = await previewWorkflow({ shopId: store.id, definition: body.definition, days });

  // An invalid definition is the merchant's answer, not a server error: the
  // editor shows these messages next to the fields that produced them.
  if (!result.valid) {
    return NextResponse.json({ valid: false, errors: result.errors }, { status: 422 });
  }

  return NextResponse.json(result);
});
