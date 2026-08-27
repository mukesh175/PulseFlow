import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { runEnrollment } from '@/lib/workflows/executor';
import { unsupportedSteps } from '@/lib/channels';

/**
 * The scheduler.
 *
 * One query drives everything: enrollments in state WAITING whose nextRunAt has
 * arrived, served by the ([state, nextRunAt]) index. The database is the only
 * source of truth for when work is due — there is no schedule held anywhere
 * else that could disagree with it.
 *
 * Vercel Cron delivers at least once and two invocations can overlap, so work
 * is claimed before it is executed. Claiming is a conditional write: a row is
 * only taken if it is still WAITING, so of two runs racing for the same
 * enrollment exactly one wins and the loser simply sees fewer rows.
 *
 * Every run is bounded. A sweep never tries to drain the queue — it takes a
 * batch, works it, and returns. The first merchant with forty thousand
 * customers should make the queue longer, not make the function time out.
 */

/** How long a claim is held before another run may take the row back. */
const LEASE_MINUTES = 5;

/** Ceiling on a single run, so it cannot exceed the function's maxDuration. */
export const DEFAULT_BATCH_SIZE = 100;

/**
 * Reclaim rows left RUNNING by a process that died mid-batch.
 *
 * This is not a rare edge case: a function timeout, a deploy mid-run, or an
 * unhandled error all leave rows leased to nobody. Without this they would stay
 * RUNNING forever and those customers would silently stop progressing.
 */
export async function reclaimStaleLeases(now = new Date()) {
  const { count } = await prisma.enrollment.updateMany({
    where: { state: 'RUNNING', lockedUntil: { lt: now } },
    data: { state: 'WAITING', lockedUntil: null, lockedBy: null },
  });
  return count;
}

/**
 * Claim up to `limit` due enrollments for this run.
 *
 * Two statements rather than one: select candidates, then conditionally take
 * them. The take is what actually decides ownership — the select is only a
 * shortlist, and any row another run grabbed in between simply fails to update
 * and is not returned.
 */
export async function claimDueEnrollments({ limit = DEFAULT_BATCH_SIZE, now = new Date(), runId }) {
  const candidates = await prisma.enrollment.findMany({
    where: { state: 'WAITING', nextRunAt: { lte: now } },
    orderBy: { nextRunAt: 'asc' },
    select: { id: true },
    take: limit,
  });

  if (candidates.length === 0) return [];

  const lockedUntil = new Date(now.getTime() + LEASE_MINUTES * 60 * 1000);

  await prisma.enrollment.updateMany({
    where: {
      id: { in: candidates.map((c) => c.id) },
      // The condition that makes this safe. A row another run already moved to
      // RUNNING no longer matches, so it is not taken twice.
      state: 'WAITING',
      nextRunAt: { lte: now },
    },
    data: { state: 'RUNNING', lockedUntil, lockedBy: runId },
  });

  // Only the rows carrying our runId were actually won.
  return prisma.enrollment.findMany({
    where: { lockedBy: runId, state: 'RUNNING' },
    select: { id: true },
  });
}

/**
 * Claim a batch and run it.
 *
 * One enrollment failing must not stop the batch: a workflow with a broken step
 * would otherwise block every other merchant's customers behind it.
 */
export async function sweep({ channels, limit = DEFAULT_BATCH_SIZE, now = new Date() } = {}) {
  if (!channels) throw new Error('sweep requires a channels implementation');

  const runId = crypto.randomUUID();
  const reclaimed = await reclaimStaleLeases(now);
  const claimed = await claimDueEnrollments({ limit, now, runId });

  const outcomes = { COMPLETED: 0, EXITED: 0, WAITING: 0, FAILED: 0 };
  const errors = [];

  let held = 0;

  for (const { id } of claimed) {
    try {
      // A journey needing a channel that is not live yet is put back rather
      // than run. Half-running it would mean a real email carrying a discount
      // code no store will honour — the customer finds out, not us.
      const blocked = await stepsNotYetLive(id, channels);
      if (blocked.length) {
        held += 1;
        await releaseUntilLater(id, now, `waiting for live channel: ${blocked.join(', ')}`);
        continue;
      }

      const result = await runEnrollment(id, { now, channels });
      outcomes[result.state] = (outcomes[result.state] ?? 0) + 1;
    } catch (error) {
      outcomes.FAILED += 1;
      errors.push({ enrollmentId: id, message: error.message });
      console.error(`[pulseflow] enrollment ${id} failed`, error);

      // Release the claim so a later run can retry, rather than leaving the row
      // pinned until its lease expires.
      await prisma.enrollment
        .update({
          where: { id },
          data: {
            state: 'WAITING',
            lockedUntil: null,
            lockedBy: null,
            attempts: { increment: 1 },
            lastError: String(error.message).slice(0, 500),
          },
        })
        .catch(() => {});
    }
  }

  // A full batch means there is more waiting. Surfaced rather than looped on,
  // because the honest response to a backlog is a shorter cron interval, not a
  // longer function.
  const drained = claimed.length < limit;

  return {
    runId,
    reclaimed,
    claimed: claimed.length,
    held,
    outcomes,
    drained,
    errors: errors.slice(0, 10),
  };
}

/**
 * Which steps in this enrollment's snapshot need a channel that is not live.
 *
 * Read from the snapshot, like everything else the executor reads, so the
 * answer describes the journey the customer is actually on rather than the
 * workflow's current definition.
 */
async function stepsNotYetLive(enrollmentId, channels) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    select: { snapshot: { select: { definition: true } } },
  });
  if (!enrollment?.snapshot) return [];
  return unsupportedSteps(channels, enrollment.snapshot.definition);
}

/**
 * Put a claimed row back without counting it as a failure.
 *
 * Held work becomes due again tomorrow rather than immediately: retrying a
 * capability that will not exist until someone deploys would just burn the
 * batch on the same rows every run.
 */
function releaseUntilLater(enrollmentId, now, reason) {
  return prisma.enrollment.update({
    where: { id: enrollmentId },
    data: {
      state: 'WAITING',
      lockedUntil: null,
      lockedBy: null,
      nextRunAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      lastError: reason,
    },
  });
}
