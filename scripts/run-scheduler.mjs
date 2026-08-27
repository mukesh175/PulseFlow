import 'dotenv/config';
import prisma from '@/lib/prisma';
import { createWorkflow, activateWorkflow } from '@/lib/workflows/manage';
import { enrollFromOrder } from '@/lib/workflows/triggers';
import { sweep, reclaimStaleLeases } from '@/lib/scheduler/sweep';
import { previewWorkflow } from '@/lib/workflows/preview';
import { createDryRunChannels } from '@/lib/channels';
import { firstOrderThankYou } from '@/lib/workflows/examples';

/**
 * Exercises phase 3 against a real database: enrollment from an order webhook
 * payload, the dry-run preview, and the lease-based sweep including the two
 * cases that actually go wrong in production — a redelivered webhook, and two
 * schedulers racing for the same enrollment.
 *
 *   npm run scheduler:demo
 *
 * Nothing reaches a real person, and everything created is deleted at the end.
 */

const DEMO_EMAIL = 'sched-harness@pulseflow.invalid';
const DEMO_ORDER_ID = '9900000001';

let workflowId = null;

function orderPayload() {
  return {
    id: DEMO_ORDER_ID,
    name: '#H1',
    email: DEMO_EMAIL,
    total_price: '49.00',
    currency: 'USD',
    financial_status: 'paid',
    processed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    customer: { id: '7700000001', email: DEMO_EMAIL, first_name: 'Harness', last_name: 'Customer', orders_count: 1 },
    line_items: [],
  };
}

async function main() {
  const store = await prisma.store.findFirst({ where: { uninstalledAt: null } });
  if (!store) {
    console.error('No installed store found. Open the app in a development store first.');
    process.exit(1);
  }
  console.log(`Store: ${store.shopDomain}\n`);

  const workflow = await createWorkflow({
    shopId: store.id,
    name: 'Harness — thank you after 3 days',
    definition: firstOrderThankYou,
    createdBy: 'manual',
  });
  workflowId = workflow.id;

  // --- preview, before activating anything --------------------------------
  const preview = await previewWorkflow({ shopId: store.id, definition: firstOrderThankYou, days: 30 });
  console.log('PREVIEW (last 30 days)');
  console.log(`  would have reached ${preview.customers} customer(s) from ${preview.ordersConsidered} order(s)`);
  for (const line of preview.steps) console.log(`    · ${line}`);
  if (preview.coverage.firstOrderDetectionIsApproximate) {
    console.log('  note: little order history synced, so "first order" is approximate');
  }
  console.log();

  // --- a draft must not enroll anyone --------------------------------------
  const beforeActivation = await enrollFromOrder({ store, payload: orderPayload() });
  console.log(`Draft workflow: enrolled=${beforeActivation.enrolled} (must be 0)`);
  if (beforeActivation.enrolled !== 0) fail('a draft workflow enrolled a customer');

  await activateWorkflow(workflow.id);
  console.log('Activated\n');

  // --- enrollment from an order, then the same webhook redelivered ---------
  const first = await enrollFromOrder({ store, payload: orderPayload() });
  const redelivered = await enrollFromOrder({ store, payload: orderPayload() });
  console.log(`Order webhook:      enrolled=${first.enrolled}`);
  console.log(`Redelivered again:  enrolled=${redelivered.enrolled}, deduped=${redelivered.deduped}`);
  if (first.enrolled !== 1 || redelivered.enrolled !== 0) fail('redelivery produced a second enrollment');

  const enrollmentCount = await prisma.enrollment.count({ where: { workflowId: workflow.id } });
  console.log(`Enrollments in database: ${enrollmentCount} (must be 1)\n`);
  if (enrollmentCount !== 1) fail('more than one enrollment exists');

  // --- two schedulers racing for the same row ------------------------------
  const channels = createDryRunChannels();
  const now = new Date();
  const [a, b] = await Promise.all([sweep({ channels, now }), sweep({ channels, now })]);
  const claimedTotal = a.claimed + b.claimed;
  console.log('CONCURRENT SWEEPS');
  console.log(`  run A claimed ${a.claimed}, run B claimed ${b.claimed} → total ${claimedTotal} (must be 1)`);
  if (claimedTotal !== 1) fail('the same enrollment was claimed twice');

  const enrollment = await prisma.enrollment.findFirst({ where: { workflowId: workflow.id } });
  console.log(`  state now ${enrollment.state}, resumes ${enrollment.nextRunAt?.toISOString().slice(0, 10)}\n`);

  // --- a stale lease is reclaimed, not lost --------------------------------
  await prisma.enrollment.update({
    where: { id: enrollment.id },
    data: { state: 'RUNNING', lockedUntil: new Date(Date.now() - 60_000), lockedBy: 'dead-process' },
  });
  const reclaimed = await reclaimStaleLeases(new Date());
  const after = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
  console.log(`STALE LEASE: reclaimed ${reclaimed} → state ${after.state} (must be WAITING)`);
  if (after.state !== 'WAITING') fail('a stale lease was not reclaimed');

  // --- run it to completion, jumping the clock ------------------------------
  console.log('\nRunning to completion:');
  let clock = new Date();
  let result;
  let pass = 0;
  do {
    pass += 1;
    result = await sweep({ channels, now: clock });
    const state = Object.entries(result.outcomes).filter(([, n]) => n > 0).map(([s, n]) => `${s}=${n}`).join(' ');
    console.log(`  sweep ${pass} @ ${clock.toISOString().slice(0, 10)} → claimed ${result.claimed} ${state}`);

    const next = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
    if (next.state === 'WAITING' && next.nextRunAt) clock = new Date(next.nextRunAt.getTime() + 1000);
    else break;
  } while (pass < 6);

  const final = await prisma.enrollment.findUnique({ where: { id: enrollment.id } });
  const messages = await prisma.messageLog.count({ where: { enrollmentId: enrollment.id } });
  console.log(`\nFinal state: ${final.state}, messages: ${messages}`);
  if (final.state !== 'COMPLETED') fail(`expected COMPLETED, got ${final.state}`);
  if (messages !== 1) fail(`expected exactly 1 message, got ${messages}`);

  // --- an already-finished enrollment must not be picked up again ----------
  const idle = await sweep({ channels, now: new Date(clock.getTime() + 86_400_000) });
  console.log(`Sweep after completion: claimed ${idle.claimed} (must be 0)`);
  if (idle.claimed !== 0) fail('a completed enrollment was claimed again');

  console.log('\nAll phase 3 checks passed.');
}

function fail(message) {
  console.error(`\nFAIL: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

async function cleanup() {
  await prisma.messageLog.deleteMany({ where: { recipient: DEMO_EMAIL } });
  await prisma.discountGrant.deleteMany({ where: { enrollment: { customerEmail: DEMO_EMAIL } } });
  if (workflowId) await prisma.workflow.delete({ where: { id: workflowId } }).catch(() => {});
  await prisma.messageLog.deleteMany({ where: { recipient: DEMO_EMAIL } });
  await prisma.order.deleteMany({ where: { shopifyOrderId: DEMO_ORDER_ID } });
  console.log('Cleaned up.');
}

main()
  .catch((error) => {
    if (!process.exitCode) console.error('\nHarness failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await prisma.$disconnect();
  });
