import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { env } from '@/lib/env';
import { purgeExpiredData } from '@/lib/retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The scheduler endpoint.
 *
 * Right now this only *reports* what is due — it deliberately executes nothing,
 * because the step executor is phase 3 and a scheduler that half-runs journeys
 * is worse than one that does not run yet.
 *
 * What is settled and encoded here is the shape:
 *
 *   - the due query is `state = WAITING AND nextRunAt <= now()`, served by the
 *     ([state, nextRunAt]) index on Enrollment
 *   - work is claimed in bounded batches by stamping lockedUntil/lockedBy
 *     before anything is executed, so two overlapping invocations cannot send
 *     the same message twice
 *   - one run never tries to drain the queue; it takes a batch and returns
 *
 * Cadence is currently daily (see vercel.json) — Vercel Hobby allows one cron
 * job at daily granularity and nothing finer.
 * A daily sweep makes "wait 30 days" accurate to the day and "wait 2 hours"
 * meaningless, so hour-scale steps must stay out of the workflow schema until
 * the plan changes. Moving to minute-level sweeps is a one-line change to the
 * cron expression: the lease columns are already in the schema and no migration
 * is involved.
 */

/** Bounded so a run cannot exceed maxDuration however long the backlog is. */
const BATCH_SIZE = 200;

function authorize(request) {
  // Vercel Cron sends a bearer token; a manual call must present the same one.
  const header = request.headers.get('authorization') || '';
  return header === `Bearer ${env.cronSecret}`;
}

export async function GET(request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();

  const due = await prisma.enrollment.count({
    where: { state: 'WAITING', nextRunAt: { lte: now } },
  });

  // Surfaced because it is the failure that will actually happen: a run that
  // crashed mid-batch leaves rows leased to a process that is gone. Phase 3
  // reclaims these once the lease expires.
  const stale = await prisma.enrollment.count({
    where: { state: 'RUNNING', lockedUntil: { lt: now } },
  });

  // Retention runs on this schedule rather than its own, because a daily
  // deletion pass is exactly what a daily cron is good for — and Hobby allows
  // only one cron job, so it has to share.
  let purged = null;
  try {
    purged = await purgeExpiredData();
  } catch (error) {
    console.error('[pulseflow] retention purge failed', error);
    purged = { error: error.message };
  }

  return NextResponse.json({
    ok: true,
    executed: false,
    reason: 'Step executor lands in phase 3',
    due,
    staleLeases: stale,
    batchSize: BATCH_SIZE,
    purged,
    at: now.toISOString(),
  });
}
