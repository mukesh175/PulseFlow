import { MIN_WAIT_DAYS, validateWorkflowDefinition } from '@/lib/workflows/schema';
import { workflowJsonSchema } from '@/lib/ai/schema';
import { activeProvider, providerLabel, generateJson } from '@/lib/ai/providers';

/**
 * Natural language to a workflow definition.
 *
 * This is the last thing built, and the brief is emphatic about why: building
 * it first demos well and leaves the executor untested. By the time anything
 * here runs, the schema, the executor, the scheduler, consent and both channels
 * have been exercised against a real store.
 *
 * Two rules shape the whole file.
 *
 * **The model writes the workflow; it does not run it.** The output is compiled
 * once into a stored definition the merchant reads and edits. Nothing at
 * runtime calls a model, so nothing at runtime depends on one being consistent.
 *
 * **The output is not trusted.** A JSON schema constrains the shape, but shape
 * is not meaning: a schema-valid definition can still promise a wait the
 * scheduler cannot honour, or check a discount that is never created. So the
 * result goes through `validateWorkflowDefinition` — the same validator a
 * hand-written definition passes — and a failure is returned to the merchant,
 * never saved.
 *
 * That second rule is also why the provider is swappable. A weaker model
 * produces more rejections, not worse automations, so running this on a free
 * tier costs accuracy rather than safety.
 */

const SYSTEM = `You turn a Shopify merchant's description of an automation into a workflow definition.

Reply with one JSON object and nothing else. No explanation, no markdown fences.

The merchant is not technical. Their sentence is the requirement; your job is to express it exactly, not to improve on it. Do not add steps they did not ask for — an unrequested discount costs them real money, and an unrequested email reaches a real customer.

The shape:

{
  "version": 1,
  "trigger": { "type": "order_created", "firstOrderOnly": true },
  "steps": [ ... ]
}

Each step is one of:

  { "type": "wait", "days": 30 }
  { "type": "condition", "check": "has_not_ordered_since_enrollment" }
  { "type": "condition", "check": "discount_unused" }
  { "type": "send_email", "subject": "...", "body": "..." }
  { "type": "create_discount", "percentage": 10, "expiresInDays": 30 }

Include only the fields listed for that step type. No others.

Rules that come from what the engine can actually do:

- Steps run in order. There is no branching. A condition that fails ends the journey.
- Waits are whole days, minimum ${MIN_WAIT_DAYS}. If the merchant asks for hours, round up to one day — the scheduler runs daily and cannot honour anything finer.
- discount_unused can only be used after a create_discount step earlier in the same workflow.
- If a message mentions a discount code, create_discount must come BEFORE the send_email that carries it.
- The last step must not be a wait, because nothing would happen at the end of it.
- Every workflow needs at least one send_email or create_discount, or it does nothing.

Writing the email:

- Write as the merchant's store speaking to their customer, in plain language.
- Use {{discount_code}} where the code should appear. It is substituted at send time.
- Do not use title case or exclamation marks in the subject. Do not invent product names, prices, or facts about the store.
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
  return activeProvider() !== null;
}

/** Which model is doing the writing, for the merchant to see. */
export function compilerName() {
  const provider = activeProvider();
  return provider ? providerLabel(provider) : null;
}

/**
 * Compile a description into a definition.
 *
 * Returns `{ definition, name, provider }`. Throws `CompileError` when the
 * result cannot be made valid — the merchant sees why, and nothing is saved.
 */
export async function compileWorkflow({ description, storeName }) {
  const provider = activeProvider();
  if (!provider) {
    throw new CompileError('The automation writer is not configured on this deployment.', { status: 503 });
  }

  const text = String(description || '').trim();
  if (text.length < 10) {
    throw new CompileError('Describe the automation in a sentence or two.', { status: 400 });
  }
  if (text.length > 2000) {
    throw new CompileError('That description is too long. A sentence or two is enough.', { status: 400 });
  }

  const user = [
    storeName ? `The store is called "${storeName}".` : null,
    'The merchant wrote:',
    // Delimited so a description containing instructions reads as the thing
    // being compiled, not as direction to follow.
    `<description>\n${text}\n</description>`,
  ]
    .filter(Boolean)
    .join('\n\n');

  let definition;
  try {
    definition = await generateJson({
      provider,
      system: SYSTEM,
      user,
      jsonSchema: workflowJsonSchema(),
    });
  } catch (error) {
    console.error('[pulseflow] compile request failed', error);
    throw new CompileError(
      `Could not reach the automation writer. ${error.message}`,
      { status: 502 }
    );
  }

  // The real gate. The schema guarantees shape; this checks meaning — ordering,
  // whether a condition has a discount to refer to, whether anything is
  // actually sent. A definition that fails here is never saved.
  const { valid, errors } = validateWorkflowDefinition(definition);
  if (!valid) {
    console.error('[pulseflow] compiled definition failed validation', errors);
    throw new CompileError(
      'That produced an automation the engine cannot run. Try describing it more simply.',
      { errors }
    );
  }

  return { definition, name: suggestName(definition, text), provider };
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
