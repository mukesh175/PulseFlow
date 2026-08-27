import 'dotenv/config';
import prisma from '@/lib/prisma';
import { createWorkflow, activateWorkflow } from '@/lib/workflows/manage';
import { enrollCustomer } from '@/lib/workflows/enroll';
import { runEnrollment } from '@/lib/workflows/executor';
import { createDryRunChannels } from '@/lib/channels';
import { thirtyDayWinback } from '@/lib/workflows/examples';
import { validateWorkflowDefinition } from '@/lib/workflows/schema';

/**
 * Runs the brief's example workflow end to end against a real database, with a
 * simulated clock so thirty-day waits take milliseconds.
 *
 * Nothing reaches a real person: the dry-run channels record what would have
 * happened and send nothing. The enrollment, step runs, message rows and
 * discount rows are real, because those are the parts being tested.
 *
 *   npm run workflow:demo
 *
 * Everything it creates is deleted at the end, including on failure.
 */

const DEMO_EMAIL = 'harness@pulseflow.invalid';

let createdWorkflowId = null;

async function main() {
  const store = await prisma.store.findFirst({ where: { uninstalledAt: null } });
  if (!store) {
    console.error('No installed store found. Open the app in a development store first.');
    process.exit(1);
  }

  console.log(`Store: ${store.shopDomain}\n`);

  // 1. The definition must survive validation before anything else happens.
  const check = validateWorkflowDefinition(thirtyDayWinback);
  if (!check.valid) {
    console.error('Definition is invalid:', check.errors);
    process.exit(1);
  }
  console.log(`Definition valid — ${thirtyDayWinback.steps.length} steps\n`);

  // 2. Create it. It is a draft, and cannot enroll anyone yet.
  const workflow = await createWorkflow({
    shopId: store.id,
    name: 'Harness — 30 day winback',
    definition: thirtyDayWinback,
    createdBy: 'manual',
  });
  createdWorkflowId = workflow.id;
  console.log(`Created workflow ${workflow.id} (${workflow.status}, v${workflow.version})`);

  try {
    await enrollCustomer({ workflow, customerEmail: DEMO_EMAIL, triggerEventId: 'demo-1' });
    console.error('FAIL: a draft workflow accepted an enrollment');
    process.exit(1);
  } catch {
    console.log('Draft workflow refused an enrollment, as it should');
  }

  const active = await activateWorkflow(workflow.id);
  console.log(`Activated (${active.status})\n`);

  // 3. Enroll, twice, with the same trigger event. The second must collapse
  //    into the first — this is the redelivered-webhook case.
  const first = await enrollCustomer({
    workflow: active,
    customerEmail: DEMO_EMAIL,
    triggerEventId: 'order-12345',
  });
  const second = await enrollCustomer({
    workflow: active,
    customerEmail: DEMO_EMAIL,
    triggerEventId: 'order-12345',
  });

  console.log(`Enrolled: created=${first.created}`);
  console.log(`Same trigger again: created=${second.created}, same row=${first.enrollment.id === second.enrollment.id}`);
  if (second.created || first.enrollment.id !== second.enrollment.id) {
    console.error('FAIL: a redelivered trigger produced a second enrollment');
    process.exit(1);
  }
  console.log();

  // 4. Run it forward, jumping the clock to each resume time.
  const channels = createDryRunChannels();
  let now = new Date();
  let result;
  let pass = 0;

  do {
    pass += 1;
    result = await runEnrollment(first.enrollment.id, { now, channels });
    const at = now.toISOString().slice(0, 10);
    console.log(
      `run ${pass} @ ${at} → ${result.state}` +
        (result.resumeAt ? `, resumes ${result.resumeAt.toISOString().slice(0, 10)}` : '') +
        (result.reason ? ` (${result.reason})` : '')
    );

    if (result.state === 'WAITING' && result.resumeAt) now = new Date(result.resumeAt.getTime() + 1000);
  } while (result.state === 'WAITING' && pass < 12);

  console.log();

  // 5. What actually happened.
  const steps = await prisma.stepRun.findMany({
    where: { enrollmentId: first.enrollment.id },
    orderBy: { stepIndex: 'asc' },
  });

  console.log('Step history:');
  for (const step of steps) {
    const detail = step.result ? JSON.stringify(step.result) : '';
    console.log(`  ${String(step.stepIndex).padStart(2)}  ${step.stepType.padEnd(16)} ${step.status.padEnd(10)} ${detail}`);
  }

  // The dry-run channel ignores `store`, so a lost relation would not show up
  // here. Assert on it directly: the real email channel reads store.id, and
  // this is the difference between working and crashing on the first live send.
  const storeSeen = channels.events.every((event) => event.storeId === store.id);
  console.log(`Store reached every channel call: ${storeSeen ? 'yes' : 'NO — relations were dropped'}`);
  if (!storeSeen) process.exit(1);

  console.log('\nSide effects the channels recorded:');
  for (const event of channels.events) {
    console.log(`  ${event.type.padEnd(9)} ${event.type === 'email' ? event.subject : event.code}`);
  }

  const messages = await prisma.messageLog.count({ where: { enrollmentId: first.enrollment.id } });
  const discounts = await prisma.discountGrant.count({ where: { enrollmentId: first.enrollment.id } });
  console.log(`\nRows written: ${messages} message(s), ${discounts} discount(s)`);

  // 6. Re-running a finished enrollment must not repeat anything.
  const again = await runEnrollment(first.enrollment.id, { now, channels });
  const messagesAfter = await prisma.messageLog.count({ where: { enrollmentId: first.enrollment.id } });
  console.log(`Re-run of a ${again.state} enrollment: ${messagesAfter === messages ? 'no new messages' : 'DUPLICATED — BUG'}`);
  if (messagesAfter !== messages) process.exit(1);

  console.log(`\nFinal state: ${result.state}`);
}

async function cleanup() {
  if (!createdWorkflowId) return;
  // Cascades to versions, enrollments and step runs; messages and discounts
  // have their enrollment set to null, so they are removed explicitly.
  await prisma.messageLog.deleteMany({ where: { recipient: DEMO_EMAIL } });
  await prisma.discountGrant.deleteMany({ where: { enrollment: { customerEmail: DEMO_EMAIL } } });
  await prisma.workflow.delete({ where: { id: createdWorkflowId } }).catch(() => {});
  await prisma.messageLog.deleteMany({ where: { recipient: DEMO_EMAIL } });
  console.log('\nCleaned up.');
}

main()
  .catch((error) => {
    console.error('\nHarness failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
