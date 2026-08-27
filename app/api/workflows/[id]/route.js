import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireStore, withStore } from '@/lib/api';
import {
  activateWorkflow,
  pauseWorkflow,
  cancelEnrollments,
  saveDefinition,
  InvalidWorkflowError,
} from '@/lib/workflows/manage';
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

  if (action === 'rename') {
    const name = String(body?.name ?? '').trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: 'A name is required.' }, { status: 400 });

    const updated = await prisma.workflow.update({ where: { id: workflow.id }, data: { name } });
    return NextResponse.json({ name: updated.name });
  }

  if (action === 'save-definition') {
    try {
      // Saves a new immutable version. Customers already inside the workflow
      // keep running the version they entered on — editing must not rewrite a
      // journey someone is halfway through.
      const updated = await saveDefinition({ workflowId: workflow.id, definition: body?.definition });
      return NextResponse.json({ version: updated.version });
    } catch (error) {
      if (error instanceof InvalidWorkflowError) {
        return NextResponse.json({ error: error.message, errors: error.errors }, { status: 422 });
      }
      throw error;
    }
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
});

/**
 * Delete an automation — or archive it, depending on what it has done.
 *
 * A workflow nobody has entered is just a draft, and deleting it should delete
 * it. One that has run is different: its enrollments, message records and
 * discount grants are the answer to "why did my customer get this?", and the
 * privacy policy says that record is kept. Destroying it because a merchant
 * tidied their list would throw away the only evidence of what was sent.
 *
 * So: hard delete while it is untouched, archive once it is not, and say which
 * happened rather than reporting both as "deleted".
 */
export const DELETE = withStore(async (request, context) => {
  const store = await requireStore();
  const { id } = await context.params;

  const workflow = await prisma.workflow.findFirst({ where: { id, shopId: store.id } });
  if (!workflow) return NextResponse.json({ error: 'Automation not found.' }, { status: 404 });

  const enrollments = await prisma.enrollment.count({ where: { workflowId: workflow.id } });

  if (enrollments === 0) {
    await prisma.workflow.delete({ where: { id: workflow.id } });
    return NextResponse.json({ outcome: 'deleted' });
  }

  // Stop anything still running before archiving, or those customers would
  // carry on inside an automation the merchant believes is gone.
  const cancelled = await cancelEnrollments(workflow.id);

  await prisma.workflow.update({
    where: { id: workflow.id },
    data: { status: 'ARCHIVED', pausedAt: new Date() },
  });

  return NextResponse.json({ outcome: 'archived', enrollments, cancelled });
});
