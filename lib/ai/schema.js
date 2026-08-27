import {
  SCHEMA_VERSION,
  CONDITION_CHECKS,
  MIN_WAIT_DAYS,
  MAX_WAIT_DAYS,
  MAX_STEPS,
} from '@/lib/workflows/schema';

/**
 * The workflow schema as JSON Schema, for constraining a model's output.
 *
 * Built from the same constants the validator uses rather than written out
 * again. Two hand-maintained copies would drift, and the drift would appear as
 * a model producing definitions the validator rejects for reasons the schema
 * never mentioned — which reads as the model being unreliable when it is
 * actually us being inconsistent.
 *
 * Each step type is its own variant under `anyOf`, with its own required
 * fields. A flat object listing every field with only `type` required was tried
 * first and produced exactly the failures you would expect: a `title` on an
 * email step, a missing `body`, a discount with no expiry. The model was not
 * being careless — nothing in the schema said otherwise.
 *
 * This still constrains shape only. Ordering rules, whether a condition has a
 * discount to refer to, whether anything is actually sent — none of that can be
 * expressed here, which is why `validateWorkflowDefinition` runs on the result
 * and is the thing that decides.
 */
export function workflowJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'trigger', 'steps'],
    properties: {
      version: {
        type: 'integer',
        description: `Always ${SCHEMA_VERSION}.`,
      },
      trigger: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'firstOrderOnly'],
        properties: {
          type: { type: 'string', enum: ['order_created'] },
          firstOrderOnly: {
            type: 'boolean',
            description: 'True to enroll only on a customer’s first order.',
          },
        },
      },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_STEPS,
        items: { anyOf: [waitStep(), conditionStep(), sendEmailStep(), createDiscountStep()] },
      },
    },
  };
}

function waitStep() {
  return {
    title: 'wait',
    type: 'object',
    additionalProperties: false,
    required: ['type', 'days'],
    properties: {
      type: { type: 'string', enum: ['wait'] },
      days: {
        type: 'integer',
        minimum: MIN_WAIT_DAYS,
        maximum: MAX_WAIT_DAYS,
        description: 'Whole days only. Automations run once a day.',
      },
    },
  };
}

function conditionStep() {
  return {
    title: 'condition',
    type: 'object',
    additionalProperties: false,
    required: ['type', 'check'],
    properties: {
      type: { type: 'string', enum: ['condition'] },
      check: {
        type: 'string',
        enum: [...CONDITION_CHECKS],
        description: 'The journey ends here if this is false.',
      },
    },
  };
}

function sendEmailStep() {
  return {
    title: 'send_email',
    type: 'object',
    additionalProperties: false,
    required: ['type', 'subject', 'body'],
    properties: {
      type: { type: 'string', enum: ['send_email'] },
      subject: { type: 'string', maxLength: 200 },
      body: {
        type: 'string',
        maxLength: 10000,
        description: 'Use {{discount_code}} where a code should appear. No unsubscribe line.',
      },
    },
  };
}

function createDiscountStep() {
  return {
    title: 'create_discount',
    type: 'object',
    additionalProperties: false,
    required: ['type', 'percentage', 'expiresInDays'],
    properties: {
      type: { type: 'string', enum: ['create_discount'] },
      percentage: { type: 'integer', minimum: 1, maximum: 100 },
      expiresInDays: { type: 'integer', minimum: 1, maximum: 365 },
      title: { type: 'string', maxLength: 120, description: 'Optional internal label.' },
    },
  };
}
