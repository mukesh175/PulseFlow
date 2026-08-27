/**
 * Hand-written workflow definitions.
 *
 * These are the shapes the AI compiler will eventually have to produce. Writing
 * them by hand first is the point of doing the compiler last: if the engine
 * cannot run a definition a human wrote, it certainly cannot be trusted with
 * one a model wrote.
 */

/**
 * The example from the brief, verbatim:
 *
 *   "Send customers an email 30 days after their first purchase with 10% off."
 *
 *   Trigger: order created (customer's first order)
 *     → Wait 30 days
 *     → Condition: customer has not ordered again
 *     → Action: send email
 *     → Action: create single-use 10% discount
 *     → Wait 7 days
 *     → Condition: discount unused
 *     → Action: send reminder
 *
 * One thing reads differently in the definition than in the prose: the discount
 * is created *after* the email in the brief's list, but the email needs the
 * code in it, so the discount is created first. That ordering problem is worth
 * knowing about before a model is asked to generate one of these.
 */
export const thirtyDayWinback = {
  version: 1,
  trigger: { type: 'order_created', firstOrderOnly: true },
  steps: [
    { type: 'wait', days: 30 },
    { type: 'condition', check: 'has_not_ordered_since_enrollment' },
    { type: 'create_discount', percentage: 10, expiresInDays: 30, title: 'Come back — 10% off' },
    {
      type: 'send_email',
      subject: 'A little something for your next order',
      body: 'Thanks for your first order with us. Here is 10% off whenever you are ready for the next one.',
    },
    { type: 'wait', days: 7 },
    { type: 'condition', check: 'discount_unused' },
    {
      type: 'send_email',
      subject: 'Your 10% is still waiting',
      body: 'Just a reminder that your discount is still available.',
    },
  ],
};

/** The simplest useful workflow: one wait, one message. */
export const firstOrderThankYou = {
  version: 1,
  trigger: { type: 'order_created', firstOrderOnly: true },
  steps: [
    { type: 'wait', days: 3 },
    {
      type: 'send_email',
      subject: 'How is everything?',
      body: 'Your order should have arrived by now. Reply to this email if anything is not right.',
    },
  ],
};
