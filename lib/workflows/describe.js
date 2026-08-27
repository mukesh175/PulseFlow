/**
 * A definition, in the words a merchant would use.
 *
 * Shared between the preview and every screen that shows an automation, so the
 * sentence a merchant reads while choosing a template is the same one they read
 * while deciding whether to activate it. Two descriptions of the same steps
 * would eventually disagree, and the merchant would have no way to know which
 * one was true.
 */
export function describeDefinition(definition) {
  return (definition?.steps ?? []).map(describeStep);
}

export function describeStep(step) {
  switch (step.type) {
    case 'wait':
      return `Wait ${step.days} day${step.days === 1 ? '' : 's'}`;

    case 'condition':
      return step.check === 'has_not_ordered_since_enrollment'
        ? 'Only continue if they have not ordered again'
        : 'Only continue if the discount is still unused';

    case 'send_email':
      return `Send an email — “${step.subject}”`;

    case 'create_discount':
      return step.percentage
        ? `Create a ${step.percentage}% discount code, valid ${step.expiresInDays} days`
        : `Create a ${step.amount} off discount code, valid ${step.expiresInDays} days`;

    default:
      return step.type;
  }
}

export function describeTrigger(definition) {
  const trigger = definition?.trigger;
  if (trigger?.type !== 'order_created') return 'Unknown trigger';
  return trigger.firstOrderOnly
    ? 'When someone places their first order'
    : 'When someone places an order';
}
