import 'dotenv/config';
import prisma from '@/lib/prisma';
import { createUnsubscribeToken, verifyUnsubscribeToken, suppress, isSuppressed, unsubscribeUrl } from '@/lib/unsubscribe';
import { createChannels, unsupportedSteps } from '@/lib/channels';
import { thirtyDayWinback, firstOrderThankYou } from '@/lib/workflows/examples';

/**
 * Exercises phase 4 without sending anything to anyone.
 *
 * The one thing it will not do is call Resend. Everything up to that point —
 * token signing, tampering, suppression, the consent lookup against the real
 * Shopify store — is real, because those are the checks that decide whether a
 * message is allowed to leave.
 *
 *   npm run email:demo
 */

const DEMO_EMAIL = 'email-harness@pulseflow.invalid';
let failures = 0;

function check(label, condition, detail = '') {
  console.log(`  ${condition ? 'pass' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

async function main() {
  const store = await prisma.store.findFirst({ where: { uninstalledAt: null } });
  if (!store) {
    console.error('No installed store found. Open the app in a development store first.');
    process.exit(1);
  }
  console.log(`Store: ${store.shopDomain}\n`);

  // --- unsubscribe tokens ---------------------------------------------------
  console.log('UNSUBSCRIBE TOKENS');
  const token = createUnsubscribeToken({ shopId: store.id, email: DEMO_EMAIL });
  const claim = verifyUnsubscribeToken(token);

  check('a valid token round-trips', claim?.email === DEMO_EMAIL && claim?.shopId === store.id);
  check('the same address always gets the same link', token === createUnsubscribeToken({ shopId: store.id, email: DEMO_EMAIL }));
  check('case and spacing are normalised', createUnsubscribeToken({ shopId: store.id, email: `  ${DEMO_EMAIL.toUpperCase()} ` }) === token);

  // Flip one character of the signature.
  const [payload, signature] = token.split('.');
  const tampered = `${payload}.${signature.slice(0, -1)}${signature.slice(-1) === 'A' ? 'B' : 'A'}`;
  check('a tampered signature is rejected', verifyUnsubscribeToken(tampered) === null);

  // Re-sign someone else's address with our own payload but the old signature.
  const otherPayload = Buffer.from(JSON.stringify({ s: store.id, e: 'someone-else@example.com' })).toString('base64url');
  check('a swapped payload is rejected', verifyUnsubscribeToken(`${otherPayload}.${signature}`) === null);
  check('garbage is rejected, not thrown on', verifyUnsubscribeToken('not-a-token') === null);
  check('an empty token is rejected', verifyUnsubscribeToken('') === null);

  console.log(`\n  link: ${unsubscribeUrl({ shopId: store.id, email: DEMO_EMAIL }).slice(0, 96)}…\n`);

  // --- suppression ----------------------------------------------------------
  console.log('SUPPRESSION');
  check('not suppressed to begin with', (await isSuppressed({ shopId: store.id, email: DEMO_EMAIL })) === false);

  await suppress({ shopId: store.id, email: DEMO_EMAIL });
  check('suppressed after unsubscribing', (await isSuppressed({ shopId: store.id, email: DEMO_EMAIL })) === true);

  await suppress({ shopId: store.id, email: DEMO_EMAIL });
  const rows = await prisma.suppression.count({ where: { shopId: store.id, email: DEMO_EMAIL } });
  check('unsubscribing twice is not an error', rows === 1, `${rows} row`);

  check(
    'suppression is per store, not global',
    (await isSuppressed({ shopId: 'some-other-store-id', email: DEMO_EMAIL })) === false
  );

  // --- the send path refuses a suppressed address ---------------------------
  console.log('\nSEND PATH');
  const channels = createChannels();
  const suppressed = await channels.sendEmail({
    store,
    recipient: DEMO_EMAIL,
    subject: 'Should never arrive',
    body: 'x',
    enrollmentId: 'harness',
  });
  check('an unsubscribed address is skipped', suppressed.status === 'SKIPPED', suppressed.skipReason);
  check('no provider call was made for it', suppressed.skipReason === 'unsubscribed');

  // A never-seen address is not suppressed, so this reaches the live consent
  // lookup against Shopify. It has no customer record, so it must be refused.
  const unknown = await channels.sendEmail({
    store,
    recipient: 'definitely-not-a-customer@pulseflow.invalid',
    subject: 'Should never arrive',
    body: 'x',
    enrollmentId: 'harness',
  });
  check('an address with no consent record is skipped', unknown.status === 'SKIPPED', unknown.skipReason);
  check('the refusal is on consent grounds', unknown.skipReason === 'no_customer_record', unknown.skipReason);

  // --- channels that are not live yet ---------------------------------------
  console.log('\nCHANNEL READINESS');
  check('email reports itself live', channels.live.email === true);
  check('discounts report themselves not live', channels.live.discount === false);
  check(
    'a workflow with a discount step is held',
    unsupportedSteps(channels, thirtyDayWinback).includes('create_discount')
  );
  check('an email-only workflow is not held', unsupportedSteps(channels, firstOrderThankYou).length === 0);

  console.log(failures === 0 ? '\nAll phase 4 checks passed.' : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

async function cleanup() {
  await prisma.suppression.deleteMany({ where: { email: DEMO_EMAIL } });
  console.log('Cleaned up.');
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
