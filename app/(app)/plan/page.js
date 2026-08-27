import { getCurrentStore } from '@/lib/session';
import { PLANS, PLAN_ORDER, usageFor, managedPricingUrl, BILLING_ENABLED } from '@/lib/billing';

export const dynamic = 'force-dynamic';

/**
 * Plan and usage.
 *
 * Usage is shown before the plans are. A merchant deciding whether to pay is
 * asking "am I running out?", not "what is on offer?" — and if the answer is
 * no, they should be able to close the page without reading a price list.
 */
export default async function PlanPage() {
  const store = await getCurrentStore();
  const usage = await usageFor(store);
  const current = usage.plan;

  const upgradeUrl = managedPricingUrl(store);
  const monthName = usage.periodStart.toLocaleString('en', { month: 'long', timeZone: 'UTC' });

  return (
    <>
      <h1 style={{ fontSize: 20, margin: 0 }}>Plan</h1>
      <p className="sp-card-sub mt-1">
        You are on <strong>{current.name}</strong>
        {current.price > 0 ? ` — $${current.price} a month.` : '.'}
      </p>

      <div className="sp-card sp-card-pad mt-4" style={{ maxWidth: 720 }}>
        <div className="sp-card-title">This month so far</div>
        <div className="sp-card-sub mt-1">Counted from 1 {monthName}, in UTC.</div>
        <hr className="sp-divider" />

        <div className="d-flex gap-4 flex-wrap">
          <Meter
            label="Messages delivered"
            used={usage.messagesSent}
            limit={usage.messagesLimit}
            note="Only messages that actually left. Anything held back for consent or an unsubscribe does not count against you."
          />
          <Meter
            label="Active automations"
            used={usage.activeWorkflows}
            limit={usage.workflowLimit}
            note="Drafts are free and unlimited. Only automations you have turned on count."
          />
        </div>

        {usage.messagesLimit !== null && usage.messagesRemaining === 0 && (
          <div className="sp-banner warning mt-3">
            <span aria-hidden="true">⏸</span>
            <div>
              <strong>This month&apos;s messages are used up.</strong>
              <div className="mt-1">
                New customers will not enter your automations until next month. Anyone already
                partway through will still finish — nobody is left with half a conversation.
              </div>
            </div>
          </div>
        )}
      </div>

      {BILLING_ENABLED && (
        <>
          <h2 style={{ fontSize: 16, margin: '32px 0 0' }}>Plans</h2>
          <div className="d-flex gap-3 flex-wrap mt-3">
            {PLAN_ORDER.map((id) => {
              const plan = PLANS[id];
              const isCurrent = plan.id === current.id;

              return (
                <div
                  key={plan.id}
                  className="sp-card sp-card-pad"
                  style={{
                    flex: '1 1 240px',
                    border: `1px solid ${isCurrent ? 'var(--sp-brand)' : 'var(--sp-line)'}`,
                    background: isCurrent ? 'var(--sp-brand-soft)' : 'var(--sp-surface)',
                  }}
                >
                  <div className="d-flex justify-content-between align-items-baseline">
                    <div className="sp-card-title">{plan.name}</div>
                    {isCurrent && <span className="sp-pill info">Current</span>}
                  </div>

                  <div style={{ fontSize: 24, fontWeight: 640, marginTop: 8 }}>
                    {plan.price === 0 ? 'Free' : `$${plan.price}`}
                    {plan.price > 0 && <span className="sp-card-sub"> /month</span>}
                  </div>

                  <ul className="mt-3 mb-0" style={{ paddingLeft: 16, fontSize: 13.5, color: 'var(--sp-ink-2)' }}>
                    {plan.highlights.map((line) => (
                      <li key={line} style={{ marginBottom: 5 }}>
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {/* Shopify owns the purchase flow under managed pricing, so this is a
              link out rather than a button that charges anyone. */}
          <a className="sp-btn sp-btn-primary mt-3" href={upgradeUrl} target="_top" rel="noreferrer">
            Change plan in Shopify
          </a>
          <div className="sp-help mt-2">
            Billing is handled by Shopify and appears on your Shopify invoice. Cancelling is on the
            same page.
          </div>
        </>
      )}
    </>
  );
}

function Meter({ label, used, limit, note }) {
  const unlimited = limit === null;
  const pct = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));
  // Amber before the wall, not at it — a merchant should hear about a limit
  // while there is still time to do something about it.
  const tone = unlimited || pct < 80 ? 'var(--sp-brand)' : pct < 100 ? 'var(--sp-warning)' : 'var(--sp-critical)';

  return (
    <div style={{ flex: '1 1 260px' }}>
      <div style={{ fontSize: 22, fontWeight: 640, fontVariantNumeric: 'tabular-nums' }}>
        {used.toLocaleString()}
        <span className="sp-card-sub" style={{ fontWeight: 400 }}>
          {unlimited ? ' of unlimited' : ` of ${limit.toLocaleString()}`}
        </span>
      </div>
      <div className="sp-label mb-0 mt-1">{label}</div>

      {!unlimited && (
        <div
          style={{
            height: 5,
            borderRadius: 3,
            background: 'var(--sp-line-soft)',
            overflow: 'hidden',
            marginTop: 8,
          }}
          role="img"
          aria-label={`${pct}% of ${label.toLowerCase()} used`}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: tone }} />
        </div>
      )}

      <div className="sp-help mt-2" style={{ maxWidth: 280 }}>
        {note}
      </div>
    </div>
  );
}
