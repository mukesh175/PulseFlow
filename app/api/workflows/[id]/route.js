import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStore, withStore } from '@/lib/api';
import { activateWorkflow, pauseWorkflow, cancelEnrollments } from '@/lib/workflows/manage';
import { createChannels, unsupportedSteps } from '@/lib/channels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Activate, pause, or stop journeys already in flight.
 *
 * Every action re-reads the workflow scoped to the caller's store first. The id
 * comes from the URL, so without that check a merchant could act on another
 * store's workflow by guessing one.
 */
export const POST = withStore(async (request, context) => {
  const store = await requireStore();
  const { id } = await context.params;

  const workflow = await prisma.workflow.findFirst({ where: { id, shopId: store.id } });
  if (!workflow) return NextResponse.json({ error: 'Automation not found.' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action === 'activate') {
    // The last check before real messages become possible. A workflow needing a
    // channel that is not live would be claimed and held by the scheduler
    // anyway; refusing here means the merchant finds out now rather than
    // wondering tomorrow why nothing happened.
    const blocked = unsupportedSteps(createChannels(), workflow.definition);
    if (blocked.length) {
      return NextResponse.json(
        { error: `This automation uses a step that is not available yet: ${blocked.join(', ')}.` },
        { status: 409 }
      );
    }

    const updated = await activateWorkflow(workflow.id);
    return NextResponse.json({ status: updated.status });
  }

  if (action === 'pause') {
    const updated = await pauseWorkflow(workflow.id);
    // Deliberately does not touch enrollments: pausing stops new customers
    // entering, and cancelling hundreds of journeys on a single click would be
    // a surprise in the wrong direction.
    return NextResponse.json({ status: updated.status });
  }

  if (action === 'cancel-enrollments') {
    const cancelled = await cancelEnrollments(workflow.id);
    return NextResponse.json({ cancelled });
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
});
