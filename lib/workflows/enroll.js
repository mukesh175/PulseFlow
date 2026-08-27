import prisma from '@/lib/prisma';
import { enrollmentFingerprint, normalizeEmail } from '@/lib/workflows/fingerprint';

/**
 * Put a customer into a workflow.
 *
 * The fingerprint plus the unique (shopId, fingerprint) constraint is what
 * makes this safe to call from a webhook handler: Shopify delivers at least
 * once, so `orders/create` for one order can arrive several times, and without
 * the collision each delivery would start another journey. Rather than checking
 * first and then inserting — which races against a concurrent delivery — this
 * inserts and treats the constraint violation as the expected answer.
 *
 * Returns `{ enrollment, created }`. `created: false` means the customer was
 * already on this journey for this event, which is a success, not a failure.
 */
export async function enrollCustomer({
  workflow,
  customerEmail,
  shopifyCustomerId = null,
  triggerEventId,
  now = new Date(),
}) {
  if (workflow.status !== 'ACTIVE') {
    throw new Error(`Cannot enroll into workflow ${workflow.id}: status is ${workflow.status}`);
  }

  const email = normalizeEmail(customerEmail);

  // The version the customer enters on is frozen here. Everything that runs
  // afterwards reads this snapshot, so editing the workflow tomorrow does not
  // rewrite a journey already in progress.
  const snapshot = await prisma.workflowVersion.findUnique({
    where: { workflowId_version: { workflowId: workflow.id, version: workflow.version } },
  });

  if (!snapshot) {
    throw new Error(`Workflow ${workflow.id} has no snapshot for version ${workflow.version}`);
  }

  const fingerprint = enrollmentFingerprint({
    workflowId: workflow.id,
    customerEmail: email,
    triggerEventId,
  });

  // Look first, then insert. The insert still catches the collision below,
  // because a concurrent delivery can land between these two statements — but
  // a redelivered webhook is routine, and letting every one of them surface a
  // database constraint error in the logs would train everyone to ignore
  // exactly the messages worth reading.
  const already = await prisma.enrollment.findUnique({
    where: { shopId_fingerprint: { shopId: workflow.shopId, fingerprint } },
  });
  if (already) return { enrollment: already, created: false };

  try {
    const enrollment = await prisma.enrollment.create({
      data: {
        shopId: workflow.shopId,
        workflowId: workflow.id,
        workflowVersionId: snapshot.id,
        customerEmail: email,
        shopifyCustomerId,
        fingerprint,
        state: 'WAITING',
        currentStepIndex: 0,
        // Due immediately: the first step runs on the next sweep. A workflow
        // that opens with a wait will set its own resume time from there.
        nextRunAt: now,
        enrolledAt: now,
      },
    });
    return { enrollment, created: true };
  } catch (error) {
    if (error.code === 'P2002') {
      const enrollment = await prisma.enrollment.findUnique({
        where: { shopId_fingerprint: { shopId: workflow.shopId, fingerprint } },
      });
      return { enrollment, created: false };
    }
    throw error;
  }
}
