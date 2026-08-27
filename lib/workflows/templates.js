import { thirtyDayWinback, firstOrderThankYou } from '@/lib/workflows/examples';

/**
 * The starting points a merchant can pick from.
 *
 * These are the four the brief's open questions settled on — the ones that are
 * the same in every store and whose audiences `lib/segments` logic already
 * knows how to find — minus the two that need customer segments the mirror
 * cannot yet answer. Waiting for real usage data to choose would have meant
 * shipping an empty screen.
 *
 * Every one is a draft when created. The template is a head start, not a
 * decision: the merchant still previews and activates.
 */
export const TEMPLATES = [
  {
    id: 'first-order-thank-you',
    name: 'Check in after a first order',
    summary: 'Three days after someone orders for the first time, ask how it went.',
    detail:
      'The lowest-risk automation to start with: no discount, one message, and it reads as service rather than marketing.',
    definition: firstOrderThankYou,
  },
  {
    id: 'thirty-day-winback',
    name: 'Win back a first-time buyer',
    summary: 'A month after a first order, offer 10% off — and remind them once if it goes unused.',
    detail:
      'Only continues for customers who have not ordered again, so it never chases someone who already came back.',
    definition: thirtyDayWinback,
  },
];

export function findTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}
