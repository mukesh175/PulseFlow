import prisma from '@/lib/prisma';
import { validateWorkflowDefinition } from '@/lib/workflows/schema';

export class InvalidWorkflowError extends Error {
  constructor(errors) {
    super(`Invalid workflow definition (${errors.length} problem${errors.length === 1 ? '' : 's'})`);
    this.name = 'InvalidWorkflowError';
    this.status = 422;
    this.errors = errors;
  }
}

/**
 * Create a workflow, always as a draft.
 *
 * There is no parameter to create one already active. The brief's second hard
 * rule is that nothing sends without explicit merchant activation, and a rule
 * with an override is not a rule.
 */
export async function createWorkflow({ shopId, name, definition, createdBy = 'manual' }) {
  assertValid(definition);

  return prisma.$transaction(async (tx) => {
    const workflow = await tx.workflow.create({
      data: { shopId, name, definition, version: 1, status: 'DRAFT', createdBy },
    });

    // The snapshot is written with the workflow, not lazily at activation.
    // An enrollment must always find a version to point at.
    await tx.workflowVersion.create({
      data: { workflowId: workflow.id, version: 1, definition },
    });

    return workflow;
  });
}

/**
 * Save a new definition as a new immutable version.
 *
 * Existing enrollments keep running the version they entered on; only customers
 * enrolled after this point see the change.
 */
export async function saveDefinition({ workflowId, definition }) {
  assertValid(definition);

  return prisma.$transaction(async (tx) => {
    const workflow = await tx.workflow.findUnique({ where: { id: workflowId } });
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    const version = workflow.version + 1;

    await tx.workflowVersion.create({ data: { workflowId, version, definition } });

    return tx.workflow.update({
      where: { id: workflowId },
      data: { definition, version },
    });
  });
}

/**
 * Activate a workflow. This is the moment a merchant accepts that real messages
 * will go to real customers, so the definition is re-validated here rather than
 * trusted from when it was saved.
 */
export async function activateWorkflow(workflowId) {
  const workflow = await prisma.workflow.findUnique({ where: { id: workflowId } });
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

  assertValid(workflow.definition);

  return prisma.workflow.update({
    where: { id: workflowId },
    data: { status: 'ACTIVE', activatedAt: new Date(), pausedAt: null },
  });
}

/**
 * Pause a workflow.
 *
 * Enrollments already inside it are deliberately left alone: pausing stops new
 * customers entering, and the merchant can cancel the ones in flight
 * separately. Silently cancelling hundreds of journeys because someone clicked
 * pause would be a surprise in the wrong direction.
 */
export async function pauseWorkflow(workflowId) {
  return prisma.workflow.update({
    where: { id: workflowId },
    data: { status: 'PAUSED', pausedAt: new Date() },
  });
}

/** Stop every journey in a workflow, without touching the workflow itself. */
export async function cancelEnrollments(workflowId) {
  const { count } = await prisma.enrollment.updateMany({
    where: { workflowId, state: { in: ['WAITING', 'RUNNING'] } },
    data: { state: 'CANCELLED', nextRunAt: null, lockedUntil: null, lockedBy: null },
  });
  return count;
}

function assertValid(definition) {
  const { valid, errors } = validateWorkflowDefinition(definition);
  if (!valid) throw new InvalidWorkflowError(errors);
}
