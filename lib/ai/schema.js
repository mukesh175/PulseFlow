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
 * This constrains shape only. Ordering rules, whether a condition has a
 * discount to refer to, whether anything is actually sent — none of that can be
 * expressed here, which is why `validateWorkflowDefinition` still runs on the
 * result and is the thing that decides.
 */
export function workflowJsonSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['version', 'trigger', 'steps'],
    properties: {
      version: { type: 'integer', enum: [SCHEMA_VERSION] },
      trigger: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'firstOrderOnly'],
        properties: {
          type: { type: 'string', enum: ['order_created'] },
          firstOrderOnly: { type: 'boolean' },
        },
      },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_STEPS,
        items: {
          // A discriminated union would be tighter, but support for `oneOf`
          // varies across providers and a rejected schema is worse than a loose
          // one. The validator closes the gap.
          type: 'object',
          additionalProperties: false,
          required: ['type'],
          properties: {
            type: {
              type: 'string',
              enum: ['wait', 'condition', 'send_email', 'create_discount'],
            },
            days: {
              type: 'integer',
              minimum: MIN_WAIT_DAYS,
              maximum: MAX_WAIT_DAYS,
              description: 'For a wait step. Whole days only.',
            },
            check: {
              type: 'string',
              enum: [...CONDITION_CHECKS],
              description: 'For a condition step.',
            },
            subject: { type: 'string', description: 'For a send_email step.' },
            body: { type: 'string', description: 'For a send_email step.' },
            percentage: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              description: 'For a create_discount step.',
            },
            expiresInDays: {
              type: 'integer',
              minimum: 1,
              maximum: 365,
              description: 'For a create_discount step.',
            },
            title: { type: 'string', description: 'Optional label for a create_discount step.' },
          },
        },
      },
    },
  };
}
