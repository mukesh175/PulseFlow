import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import {
  SCHEMA_VERSION,
  CONDITION_CHECKS,
  MIN_WAIT_DAYS,
  MAX_WAIT_DAYS,
  MAX_STEPS,
  validateWorkflowDefinition,
} from '@/lib/workflows/schema';

/**
 * Natural language to a workflow definition.
 *
 * This is the last thing built, and the brief is emphatic about why: building
 * it first demos well and leaves the executor untested. By the time anything
 * here runs, the schema, the executor, the scheduler, consent and the channels
 * have all been exercised against a real store.
 *
 * Two rules shape the whole file.
 *
 * **The model writes the workflow; it does not run it.** The output is compiled
 * once into a stored definition the merchant reads and edits. Nothing at
 * runtime calls a model, so nothing at runtime depends on one being consistent.
 *
 * **The output is not trusted.** Structured outputs constrain the shape, but
 * shape is not meaning: a schema-valid definition can still promise a two-hour
 * wait the scheduler cannot honour, or check a discount that is never created.
 * So the result goes through `validateWorkflowDefinition` — the same validator
 * a hand-written definition passes — and a failure is returned to the merchant,
 * never saved.
 */

/**
 * The Zod schema mirrors the validator, and takes its enums and bounds from the
 * same exported constants. Two hand-maintained copies would drift, and the
 * drift would show up as a model producing definitions that the validator then
 * rejects for reasons the prompt never mentioned.
 */
const WaitStep = z.object({
  type: z.literal('wait'),
  days: z.number().int().min(MIN_WAIT_DAYS).max(MAX_WAIT_DAYS),
});

const ConditionStep = z.object({
  type: z.literal('condition'),
  check: z.enum(CONDITION_CHECKS),
});

const SendEmailStep = z.object({
  type: z.literal('send_email'),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(10000),
});

const CreateDiscountStep = z.object({
  type: z.literal('create_discount'),
  percentage: z.number().int().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(365),
  title: z.string().max(120).optional(),
});

const WorkflowSchema = z.object({
  version: z.literal(SCHEMA_VERSION),
  trigger: z.object({
    type: z.literal('order_created'),
    firstOrderOnly: z.boolean(),
  }),
  steps: z.array(z.union([WaitStep, ConditionStep, SendEmailStep, CreateDiscountStep])).min(1).max(MAX_STEPS),
});

const SYSTEM = `You turn a Shopify merchant's description of an automation into a workflow definition.

The merchant is not technical. Their sentence is the requirement; your job is to express it exactly, not to improve on it. Do not add steps they did not ask for — an unrequested discount costs them real money, and an unrequested email reaches a real customer.

Rules that come from what the engine can actually do:

- Steps run in order. There is no branching. A condition that fails ends the journey.
- Waits are whole days, minimum ${MIN_WAIT_DAYS}. If the merchant asks for hours, round up to one day — the scheduler runs daily and cannot honour anything finer.
- Only two conditions exist: has_not_ordered_since_enrollment, and discount_unused.
- discount_unused can only be used after a create_discount step earlier in the same workflow.
- If a message mentions a discount code, the create_discount step must come BEFORE the send_email step, so the code exists when the email is written.
- The last step must not be a wait, because nothing would happen at the end of it.
- Every workflow needs at least one send_email or create_discount, or it does nothing.

Writing the email:

- Write as the merchant's store speaking to their customer, in plain language.
- Use {{discount_code}} where the code should appear. It is substituted at send time.
- Do not write a subject line in title case or with exclamation marks. Do not invent product names, prices, or facts about the store.
- Do not write an unsubscribe line. One is added automatically.

If the merchant's description is ambiguous, choose the more conservative reading: fewer messages, smaller discounts, longer waits.`;

export class CompileError extends Error {
  constructor(message, { errors = [], status = 422 } = {}) {
    super(message);
    this.name = 'CompileError';
    this.status = status;
    this.errors = errors;
  }
}

export function isCompilerConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Compile a description into a definition.
 *
 * Returns `{ definition, name, usage }`. Throws `CompileError` when the result
 * cannot be made valid — the merchant sees why, and nothing is saved.
 */
export async function compileWorkflow({ description, storeName }) {
  if (!isCompilerConfigured()) {
    throw new CompileError('The automation writer is not configured on this deployment.', { status: 503 });
  }

  const text = String(description || '').trim();
  if (text.length < 10) {
    throw new CompileError('Describe the automation in a sentence or two.', { status: 400 });
  }
  if (text.length > 2000) {
    throw new CompileError('That description is too long. A sentence or two is enough.', { status: 400 });
  }

  const client = new Anthropic();

  let response;
  try {
    response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            storeName ? `The store is called "${storeName}".` : null,
            'The merchant wrote:',
            // Delimited so a description containing instructions reads as the
            // thing being compiled, not as direction to follow.
            `<description>\n${text}\n</description>`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ],
      output_config: { format: zodOutputFormat(WorkflowSchema) },
    });
  } catch (error) {
    console.error('[pulseflow] compile request failed', error);
    throw new CompileError('Could not reach the automation writer. Try again in a moment.', { status: 502 });
  }

  const definition = response.parsed_output;
  if (!definition) {
    throw new CompileError('The automation writer returned something unreadable. Try rewording your description.');
  }

  // The real gate. Structured outputs guarantee shape; this checks meaning —
  // ordering, whether a condition has a discount to refer to, whether anything
  // is actually sent. A definition that fails here is never saved.
  const { valid, errors } = validateWorkflowDefinition(definition);
  if (!valid) {
    console.error('[pulseflow] compiled definition failed validation', errors);
    throw new CompileError(
      'That produced an automation the engine cannot run. Try describing it more simply.',
      { errors }
    );
  }

  return {
    definition,
    name: suggestName(definition, text),
    usage: {
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
    },
  };
}

/**
 * A name from the definition rather than from the model.
 *
 * Asking for a name in the same call means one more field that can come back
 * wrong, for something the merchant will rename anyway.
 */
function suggestName(definition, description) {
  const first = description.split(/[.\n]/)[0].trim();
  if (first.length >= 8 && first.length <= 60) {
    return first.charAt(0).toUpperCase() + first.slice(1);
  }

  const hasDiscount = definition.steps.some((s) => s.type === 'create_discount');
  const wait = definition.steps.find((s) => s.type === 'wait');

  if (hasDiscount && wait) return `Win back after ${wait.days} days`;
  if (wait) return `Follow up after ${wait.days} days`;
  return 'New automation';
}
