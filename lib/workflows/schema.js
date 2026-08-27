/**
 * The workflow definition schema.
 *
 * This is the contract at the centre of the app. A merchant reads and edits
 * these objects; the executor runs them; and in the last phase the AI compiler
 * will produce them from a sentence. That last consumer is why the validator is
 * strict rather than forgiving: a model will eventually generate these, and the
 * only thing standing between a hallucinated field and a real customer's inbox
 * is a rejection here. Unknown keys are errors, not ignored.
 *
 * A definition is deliberately linear — a list of steps, run in order. The
 * brief's own example is linear, and a condition that fails ends the journey
 * rather than branching. Branching can be added later; adding it now would mean
 * designing a graph editor before a single message has ever been sent.
 *
 * Shape:
 *
 *   {
 *     version: 1,
 *     trigger: { type: 'order_created', firstOrderOnly: true },
 *     steps: [
 *       { type: 'wait', days: 30 },
 *       { type: 'condition', check: 'has_not_ordered_since_enrollment' },
 *       { type: 'send_email', subject: '...', body: '...' },
 *       { type: 'create_discount', percentage: 10, expiresInDays: 30 }
 *     ]
 *   }
 */

export const SCHEMA_VERSION = 1;

export const TRIGGER_TYPES = ['order_created'];

export const STEP_TYPES = ['wait', 'condition', 'send_email', 'create_discount'];

/**
 * Conditions are limited to questions the local mirror can actually answer.
 * A condition we cannot evaluate offline would mean a Shopify API call inside
 * the scheduler, turning one slow store into everyone's outage.
 */
export const CONDITION_CHECKS = [
  /// No order placed since the customer entered this workflow. The winback
  /// case: stop chasing someone who already came back.
  'has_not_ordered_since_enrollment',
  /// A discount issued earlier in this workflow has not been used yet.
  'discount_unused',
];

/**
 * Waits are whole days, and one day is the minimum.
 *
 * This is not arbitrary: the scheduler runs on a daily cron (Vercel Hobby
 * allows nothing finer), so a two-hour wait would silently become an
 * eighteen-hour one. Rather than accept a value we cannot honour, the schema
 * refuses to express it. When the sweep moves to minute-level, this is where
 * hours get added — and the executor will not need to change.
 */
export const MIN_WAIT_DAYS = 1;
export const MAX_WAIT_DAYS = 365;

export const MAX_STEPS = 20;

const STEP_FIELDS = {
  wait: { required: ['days'], optional: [] },
  condition: { required: ['check'], optional: [] },
  send_email: { required: ['subject', 'body'], optional: ['preheader'] },
  create_discount: { required: ['expiresInDays'], optional: ['percentage', 'amount', 'title'] },
};

const TRIGGER_FIELDS = {
  order_created: { required: [], optional: ['firstOrderOnly'] },
};

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isInteger(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isNonEmptyString(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

/**
 * Validate a definition.
 *
 * Returns `{ valid, errors }`. Errors are addressed to whoever has to fix the
 * definition — a merchant reading them in the UI, or a compiler being told what
 * it got wrong — so each one names the path and says what was expected.
 */
export function validateWorkflowDefinition(definition) {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });

  if (!isPlainObject(definition)) {
    return { valid: false, errors: [{ path: '', message: 'A workflow definition must be an object.' }] };
  }

  checkUnknownKeys(definition, ['version', 'trigger', 'steps'], '', fail);

  if (definition.version !== SCHEMA_VERSION) {
    fail('version', `Expected version ${SCHEMA_VERSION}, got ${JSON.stringify(definition.version)}.`);
  }

  validateTrigger(definition.trigger, fail);
  validateSteps(definition.steps, fail);

  return { valid: errors.length === 0, errors };
}

function checkUnknownKeys(object, allowed, prefix, fail) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      fail(prefix ? `${prefix}.${key}` : key, `Unknown field "${key}". Allowed: ${allowed.join(', ')}.`);
    }
  }
}

function validateTrigger(trigger, fail) {
  if (!isPlainObject(trigger)) {
    fail('trigger', 'A trigger is required.');
    return;
  }

  if (!TRIGGER_TYPES.includes(trigger.type)) {
    fail('trigger.type', `Unknown trigger type. Allowed: ${TRIGGER_TYPES.join(', ')}.`);
    return;
  }

  const spec = TRIGGER_FIELDS[trigger.type];
  checkUnknownKeys(trigger, ['type', ...spec.required, ...spec.optional], 'trigger', fail);

  if ('firstOrderOnly' in trigger && typeof trigger.firstOrderOnly !== 'boolean') {
    fail('trigger.firstOrderOnly', 'Must be true or false.');
  }
}

function validateSteps(steps, fail) {
  if (!Array.isArray(steps) || steps.length === 0) {
    fail('steps', 'A workflow needs at least one step.');
    return;
  }

  if (steps.length > MAX_STEPS) {
    fail('steps', `A workflow can have at most ${MAX_STEPS} steps, got ${steps.length}.`);
    return;
  }

  steps.forEach((step, index) => validateStep(step, index, fail));

  // Semantic rules — each of these describes a definition that parses but
  // cannot do anything useful, which is worse than one that fails to parse.
  const types = steps.map((s) => (isPlainObject(s) ? s.type : null));

  if (!types.some((t) => t === 'send_email' || t === 'create_discount')) {
    fail('steps', 'A workflow that never sends or creates anything has no effect. Add an action step.');
  }

  if (types[types.length - 1] === 'wait') {
    fail(
      `steps[${types.length - 1}]`,
      'The last step is a wait, so nothing happens at the end of it. Remove it or add a step after it.'
    );
  }

  steps.forEach((step, index) => {
    if (isPlainObject(step) && step.check === 'discount_unused') {
      const hasEarlierDiscount = types.slice(0, index).includes('create_discount');
      if (!hasEarlierDiscount) {
        fail(
          `steps[${index}].check`,
          'This checks whether a discount was used, but no discount is created earlier in the workflow.'
        );
      }
    }
  });
}

function validateStep(step, index, fail) {
  const at = `steps[${index}]`;

  if (!isPlainObject(step)) {
    fail(at, 'Each step must be an object.');
    return;
  }

  if (!STEP_TYPES.includes(step.type)) {
    fail(`${at}.type`, `Unknown step type ${JSON.stringify(step.type)}. Allowed: ${STEP_TYPES.join(', ')}.`);
    return;
  }

  const spec = STEP_FIELDS[step.type];
  checkUnknownKeys(step, ['type', ...spec.required, ...spec.optional], at, fail);

  for (const field of spec.required) {
    if (!(field in step)) fail(`${at}.${field}`, `"${field}" is required for a ${step.type} step.`);
  }

  if (step.type === 'wait' && 'days' in step) {
    if (!isInteger(step.days, MIN_WAIT_DAYS, MAX_WAIT_DAYS)) {
      fail(
        `${at}.days`,
        `Must be a whole number of days between ${MIN_WAIT_DAYS} and ${MAX_WAIT_DAYS}. ` +
          'Waits shorter than a day cannot be honoured on the current schedule.'
      );
    }
  }

  if (step.type === 'condition' && 'check' in step && !CONDITION_CHECKS.includes(step.check)) {
    fail(`${at}.check`, `Unknown condition. Allowed: ${CONDITION_CHECKS.join(', ')}.`);
  }

  if (step.type === 'send_email') {
    if ('subject' in step && !isNonEmptyString(step.subject, 200)) {
      fail(`${at}.subject`, 'Must be a non-empty string of at most 200 characters.');
    }
    if ('body' in step && !isNonEmptyString(step.body, 10000)) {
      fail(`${at}.body`, 'Must be a non-empty string of at most 10000 characters.');
    }
  }

  if (step.type === 'create_discount') {
    validateDiscountAmount(step, at, fail);
    if ('expiresInDays' in step && !isInteger(step.expiresInDays, 1, 365)) {
      fail(`${at}.expiresInDays`, 'Must be a whole number of days between 1 and 365.');
    }
  }
}

function validateDiscountAmount(step, at, fail) {
  const hasPercentage = 'percentage' in step;
  const hasAmount = 'amount' in step;

  // Exactly one. Both would be ambiguous, and a discount step that specifies
  // neither would create a code worth nothing — which the merchant would only
  // discover from a confused customer.
  if (hasPercentage === hasAmount) {
    fail(at, 'A discount needs exactly one of "percentage" or "amount".');
    return;
  }

  if (hasPercentage && !isInteger(step.percentage, 1, 100)) {
    fail(`${at}.percentage`, 'Must be a whole number between 1 and 100.');
  }

  if (hasAmount && !(typeof step.amount === 'number' && step.amount > 0 && step.amount <= 100000)) {
    fail(`${at}.amount`, 'Must be a positive number.');
  }
}

/** Throwing form, for callers that treat an invalid definition as a bug. */
export function assertValidWorkflowDefinition(definition) {
  const { valid, errors } = validateWorkflowDefinition(definition);
  if (!valid) {
    const detail = errors.map((e) => `${e.path || '(root)'}: ${e.message}`).join('; ');
    throw new Error(`Invalid workflow definition — ${detail}`);
  }
  return definition;
}
