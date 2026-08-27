import 'dotenv/config';
import prisma from '@/lib/prisma';
import { renderBody, placeholdersUsed } from '@/lib/workflows/merge';
import { validateWorkflowDefinition } from '@/lib/workflows/schema';
import { compileWorkflow, isCompilerConfigured } from '@/lib/ai/compile';
import { describeDefinition } from '@/lib/workflows/describe';
import { attributionFor } from '@/lib/workflows/attribution';

/**
 * Phases 6 and 7.
 *
 * The placeholder and validation checks run without any credentials, because
 * they are the parts that decide whether a compiled definition is allowed near
 * a customer. The compile call itself runs only when ANTHROPIC_API_KEY is set —
 * and it is the one part that cannot be proven without it.
 *
 *   npm run compile:demo
 */

let failures = 0;

function check(label, condition, detail = '') {
  console.log(`  ${condition ? 'pass' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures += 1;
}

async function main() {
  // --- placeholders ---------------------------------------------------------
  console.log('PLACEHOLDERS');

  const filled = renderBody('Here is {{discount_code}} for you, {{customer_name}}.', {
    discount_code: 'PF-ABC123',
    customer_name: 'Priya',
  });
  check('known placeholders are substituted', filled.text === 'Here is PF-ABC123 for you, Priya.', filled.text);
  check('nothing reported missing', filled.missing.length === 0);

  const noValue = renderBody('Use {{discount_code}} today.', { discount_code: null });
  check('a placeholder with no value is reported', noValue.missing.includes('discount_code'));
  check('and is left visible rather than blanked', noValue.text.includes('{{discount_code}}'), noValue.text);

  const typo = renderBody('Use {{discout_code}} today.', { discount_code: 'PF-ABC123' });
  check('an unknown placeholder is left alone', typo.text.includes('{{discout_code}}'));
  check('and is not treated as missing', typo.missing.length === 0);

  const injection = renderBody('{{customer_name}}', { customer_name: '{{discount_code}}' });
  check(
    'a value that looks like a placeholder is not re-expanded',
    injection.text === '{{discount_code}}',
    injection.text
  );

  check('placeholdersUsed finds only known ones', placeholdersUsed('{{discount_code}} {{nope}}').join() === 'discount_code');

  // --- the gate that protects customers from a bad compile ------------------
  console.log('\nVALIDATION GATE');

  // Shapes a model could plausibly produce that must not reach a customer.
  const hallucinated = {
    version: 1,
    trigger: { type: 'order_created', firstOrderOnly: true },
    steps: [
      { type: 'wait', days: 30 },
      { type: 'send_sms', to: 'customer' },
    ],
  };
  check('an invented step type is rejected', validateWorkflowDefinition(hallucinated).valid === false);

  const subDay = {
    version: 1,
    trigger: { type: 'order_created', firstOrderOnly: true },
    steps: [{ type: 'wait', days: 0 }, { type: 'send_email', subject: 'a', body: 'b' }],
  };
  check('a wait the scheduler cannot honour is rejected', validateWorkflowDefinition(subDay).valid === false);

  const orphanCondition = {
    version: 1,
    trigger: { type: 'order_created', firstOrderOnly: true },
    steps: [
      { type: 'condition', check: 'discount_unused' },
      { type: 'send_email', subject: 'a', body: 'b' },
    ],
  };
  check(
    'checking a discount that is never created is rejected',
    validateWorkflowDefinition(orphanCondition).valid === false
  );

  // --- the compiler itself --------------------------------------------------
  console.log('\nCOMPILER');
  if (!isCompilerConfigured()) {
    console.log('  skipped — ANTHROPIC_API_KEY is not set, so the compile path is UNVERIFIED');
  } else {
    const store = await prisma.store.findFirst({ where: { uninstalledAt: null } });
    const { definition, name } = await compileWorkflow({
      description:
        'Email customers 30 days after their first purchase with 10% off, and remind them a week later if they have not used it.',
      storeName: store?.shopName,
    });

    console.log(`  name: ${name}`);
    for (const line of describeDefinition(definition)) console.log(`    · ${line}`);

    check('the compiled definition is valid', validateWorkflowDefinition(definition).valid === true);
    check('it waits about a month first', definition.steps[0]?.type === 'wait' && definition.steps[0].days >= 28);
    check('it creates a discount', definition.steps.some((s) => s.type === 'create_discount'));
    check('it sends at least one email', definition.steps.some((s) => s.type === 'send_email'));

    const discountIndex = definition.steps.findIndex((s) => s.type === 'create_discount');
    const emailIndex = definition.steps.findIndex((s) => s.type === 'send_email');
    check('the discount is created before the email that carries it', discountIndex < emailIndex);
  }

  // --- attribution ----------------------------------------------------------
  console.log('\nATTRIBUTION');
  const store = await prisma.store.findFirst({ where: { uninstalledAt: null } });
  if (store) {
    const result = await attributionFor({ shopId: store.id, workflowId: 'no-such-workflow' });
    check('an unknown workflow reports zero rather than throwing', result.direct.revenue === 0);
    check('and reports the two kinds separately', 'direct' in result && 'influenced' in result);
    check('the influence window is stated', result.windowDays === 7, `${result.windowDays} days`);
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error('\nHarness failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
