import prisma from '@/lib/prisma';
import { assertValidWorkflowDefinition } from '@/lib/workflows/schema';

/**
 * The step executor.
 *
 * Runs one enrollment forward through its workflow until it hits a wait or
 * reaches a terminal state. It does not decide *when* to run — that is the
 * scheduler's job in phase 3 — and it does not claim the row it is given. A
 * caller must have claimed it already, or be running single-threaded.
 *
 * Two properties matter more than anything else here.
 *
 * **Steps are idempotent.** Every side effect is keyed on
 * `enrollmentId:stepIndex`, so running the same step twice produces one email,
 * not two. This is not an optimisation — a retried step is the normal case
 * (a crashed run, an expired lease, a redelivery), and a duplicate discount
 * email is the app's worst failure.
 *
 * **The definition is read from the snapshot, never from the workflow.** An
 * enrollment runs the version it entered on. Editing a live workflow must not
 * rewrite the journey of a customer already halfway through it.
 */

/** How many steps one call may run before returning, so a loop cannot hang. */
const MAX_STEPS_PER_RUN = 20;

const TERMINAL = new Set(['COMPLETED', 'EXITED', 'CANCELLED', 'FAILED']);

/**
 * Advance one enrollment as far as it will go right now.
 *
 * `now` is injectable so a workflow with thirty-day waits can be tested in a
 * second rather than a month.
 */
export async function runEnrollment(enrollmentId, { now = new Date(), channels } = {}) {
  if (!channels) throw new Error('runEnrollment requires a channels implementation');

  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: { snapshot: true, store: true },
  });

  if (!enrollment) throw new Error(`Enrollment ${enrollmentId} not found`);
  if (TERMINAL.has(enrollment.state)) {
    return { state: enrollment.state, ranSteps: 0, reason: 'already terminal' };
  }

  const definition = assertValidWorkflowDefinition(enrollment.snapshot.definition);

  let current = enrollment;
  let ranSteps = 0;

  while (ranSteps < MAX_STEPS_PER_RUN) {
    // Past the end of the list: the journey finished.
    if (current.currentStepIndex >= definition.steps.length) {
      current = await transition(current, { state: 'COMPLETED', completedAt: now, nextRunAt: null });
      return { state: 'COMPLETED', ranSteps };
    }

    const stepIndex = current.currentStepIndex;
    const step = definition.steps[stepIndex];

    let outcome;
    try {
      outcome = await runStep({ enrollment: current, step, stepIndex, now, channels });
    } catch (error) {
      await recordStepRun({ enrollment: current, step, stepIndex, status: 'FAILED', now, error });
      current = await transition(current, {
        state: 'FAILED',
        lastError: String(error.message).slice(0, 500),
        nextRunAt: null,
        attempts: { increment: 1 },
      });
      return { state: 'FAILED', ranSteps, error: error.message };
    }

    await recordStepRun({
      enrollment: current,
      step,
      stepIndex,
      status: outcome.status,
      now,
      result: outcome.result,
      scheduledFor: outcome.resumeAt ?? null,
    });

    ranSteps += 1;

    if (outcome.kind === 'exit') {
      current = await transition(current, {
        state: 'EXITED',
        completedAt: now,
        nextRunAt: null,
        currentStepIndex: stepIndex + 1,
      });
      return { state: 'EXITED', ranSteps, reason: outcome.reason };
    }

    if (outcome.kind === 'wait') {
      // The wait consumes itself: the index moves past it now, and the next run
      // resumes at the step after. That way "have we already waited?" is never
      // a question anyone has to answer.
      current = await transition(current, {
        currentStepIndex: stepIndex + 1,
        nextRunAt: outcome.resumeAt,
        state: 'WAITING',
        lockedUntil: null,
        lockedBy: null,
      });
      return { state: 'WAITING', ranSteps, resumeAt: outcome.resumeAt };
    }

    current = await transition(current, { currentStepIndex: stepIndex + 1 });
  }

  // Hit the per-run ceiling with steps left. Leave it due immediately so the
  // next run picks up where this one stopped.
  await transition(current, { state: 'WAITING', nextRunAt: now, lockedUntil: null, lockedBy: null });
  return { state: 'WAITING', ranSteps, reason: 'step limit reached' };
}

// ---------------------------------------------------------------------------
// Individual steps
// ---------------------------------------------------------------------------

async function runStep({ enrollment, step, stepIndex, now, channels }) {
  switch (step.type) {
    case 'wait':
      return {
        kind: 'wait',
        status: 'SUCCEEDED',
        resumeAt: new Date(now.getTime() + step.days * 24 * 60 * 60 * 1000),
        result: { days: step.days },
      };

    case 'condition': {
      const passed = await evaluateCondition({ enrollment, check: step.check, now });
      return passed
        ? { kind: 'continue', status: 'SUCCEEDED', result: { check: step.check, passed: true } }
        : {
            kind: 'exit',
            status: 'SKIPPED',
            reason: step.check,
            result: { check: step.check, passed: false },
          };
    }

    case 'send_email':
      return sendEmailStep({ enrollment, step, stepIndex, now, channels });

    case 'create_discount':
      return createDiscountStep({ enrollment, step, now, channels });

    default:
      // Unreachable through the validator, but an executor that silently
      // skipped an unknown step would be worse than one that stops.
      throw new Error(`Unsupported step type "${step.type}"`);
  }
}

async function evaluateCondition({ enrollment, check, now }) {
  switch (check) {
    case 'has_not_ordered_since_enrollment': {
      const since = await prisma.order.count({
        where: {
          shopId: enrollment.shopId,
          customerEmail: enrollment.customerEmail,
          processedAt: { gt: enrollment.enrolledAt },
          cancelledAt: null,
        },
      });
      return since === 0;
    }

    case 'discount_unused': {
      const grant = await prisma.discountGrant.findFirst({
        where: { enrollmentId: enrollment.id },
        orderBy: { createdAt: 'desc' },
      });
      // No discount at all means there is nothing to chase, which reads as
      // "used" for the purpose of continuing — the validator prevents this
      // shape, so reaching it means something went wrong upstream.
      if (!grant) return false;
      if (grant.revokedAt) return false;
      if (grant.expiresAt && grant.expiresAt <= now) return false;
      return grant.usedAt === null;
    }

    default:
      throw new Error(`Unsupported condition "${check}"`);
  }
}

/**
 * The dedupe key is the whole send-once guarantee.
 *
 * It is derived, not random: the same enrollment at the same step always
 * produces the same key, so a retry collides with the row the first attempt
 * wrote and the second send never happens. A random key would make every retry
 * a fresh send.
 */
function dedupeKeyFor(enrollment, stepIndex) {
  return `${enrollment.id}:${stepIndex}`;
}

async function sendEmailStep({ enrollment, step, stepIndex, now, channels }) {
  const dedupeKey = dedupeKeyFor(enrollment, stepIndex);

  const existing = await prisma.messageLog.findUnique({
    where: { shopId_dedupeKey: { shopId: enrollment.shopId, dedupeKey } },
  });
  if (existing) {
    return {
      kind: 'continue',
      status: 'SUCCEEDED',
      result: { messageLogId: existing.id, deduped: true, status: existing.status },
    };
  }

  // Claim the key before sending. If the send succeeds and the process dies
  // before we record it, the row is already there and the retry will not send
  // again — losing the delivery record is recoverable, sending twice is not.
  let row;
  try {
    row = await prisma.messageLog.create({
      data: {
        shopId: enrollment.shopId,
        enrollmentId: enrollment.id,
        channel: 'EMAIL',
        recipient: enrollment.customerEmail,
        subject: step.subject,
        dedupeKey,
        status: 'QUEUED',
      },
    });
  } catch (error) {
    if (error.code === 'P2002') {
      // Another run claimed it between our check and our write.
      return { kind: 'continue', status: 'SUCCEEDED', result: { deduped: true } };
    }
    throw error;
  }

  const outcome = await channels.sendEmail({
    store: enrollment.store,
    recipient: enrollment.customerEmail,
    subject: step.subject,
    body: step.body,
    preheader: step.preheader ?? null,
    enrollmentId: enrollment.id,
  });

  await prisma.messageLog.update({
    where: { id: row.id },
    data: {
      status: outcome.status,
      skipReason: outcome.skipReason ?? null,
      providerMessageId: outcome.providerMessageId ?? null,
      error: outcome.error ?? null,
      sentAt: outcome.status === 'SENT' ? now : null,
    },
  });

  // A skipped send is not a failure of the workflow. Consent withdrawn or an
  // unsubscribe means this person should not get this message — the journey
  // continues, and the reason is on the record.
  return {
    kind: 'continue',
    status: outcome.status === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
    result: { messageLogId: row.id, status: outcome.status, skipReason: outcome.skipReason ?? null },
  };
}

// No stepIndex here, unlike sendEmailStep: a discount is deduped per
// enrollment rather than per step, so the step it came from is not part of the
// identity.
async function createDiscountStep({ enrollment, step, now, channels }) {
  const existing = await prisma.discountGrant.findFirst({
    where: { enrollmentId: enrollment.id, code: { not: '' } },
    orderBy: { createdAt: 'desc' },
  });

  // Discounts are keyed per enrollment rather than per step: a workflow that
  // issued a second code would give one customer two live discounts, which the
  // merchant did not ask for.
  if (existing) {
    return { kind: 'continue', status: 'SUCCEEDED', result: { code: existing.code, deduped: true } };
  }

  const expiresAt = new Date(now.getTime() + step.expiresInDays * 24 * 60 * 60 * 1000);

  const grant = await channels.createDiscount({
    store: enrollment.store,
    percentage: step.percentage ?? null,
    amount: step.amount ?? null,
    title: step.title ?? null,
    expiresAt,
    customerEmail: enrollment.customerEmail,
    // Passed so the code can be locked to this one customer. Null for a guest
    // checkout, where Shopify has no customer record to restrict it to.
    shopifyCustomerId: enrollment.shopifyCustomerId,
    enrollmentId: enrollment.id,
  });

  const row = await prisma.discountGrant.create({
    data: {
      shopId: enrollment.shopId,
      enrollmentId: enrollment.id,
      shopifyDiscountId: grant.shopifyDiscountId ?? null,
      code: grant.code,
      percentage: step.percentage ?? null,
      amount: step.amount ?? null,
      expiresAt,
    },
  });

  return { kind: 'continue', status: 'SUCCEEDED', result: { code: row.code, discountGrantId: row.id } };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

function transition(enrollment, data) {
  return prisma.enrollment.update({ where: { id: enrollment.id }, data });
}

function recordStepRun({ enrollment, step, stepIndex, status, now, result, error, scheduledFor }) {
  const data = {
    stepType: step.type,
    status,
    ranAt: now,
    scheduledFor: scheduledFor ?? null,
    result: result ?? null,
    error: error ? String(error.message).slice(0, 500) : null,
  };

  // Upsert rather than create: a retried step already has a row, and losing the
  // history of the first attempt is preferable to the whole run failing on a
  // unique constraint.
  return prisma.stepRun.upsert({
    where: { enrollmentId_stepIndex: { enrollmentId: enrollment.id, stepIndex } },
    create: { enrollmentId: enrollment.id, stepIndex, ...data },
    update: data,
  });
}
