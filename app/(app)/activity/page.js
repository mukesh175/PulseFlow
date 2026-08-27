import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getCurrentStore } from '@/lib/session';
import { logCustomerDataAccess } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Everything the app has sent, and everything it decided not to send.
 *
 * This screen is the app answering its own central question: "why did my
 * customer get this?" — and, just as often, "why didn't they?". The data has
 * existed since the first send; without somewhere to read it, a merchant had to
 * take our word for what happened.
 *
 * Skipped messages are shown alongside delivered ones rather than hidden. A
 * refusal is a decision the app made on the merchant's behalf, and it is the
 * one they are most likely to need explained.
 */

const STATUS = {
  SENT: { label: 'Delivered', tone: 'success' },
  QUEUED: { label: 'Sending', tone: 'info' },
  SKIPPED: { label: 'Not sent', tone: 'neutral' },
  FAILED: { label: 'Failed', tone: 'critical' },
};

/** Reasons in the merchant's words, not the system's. */
const SKIP_REASON = {
  unsubscribed: 'They unsubscribed from your emails',
  no_customer_record: 'No customer record in Shopify to check consent against',
  consent_not_subscribed: 'They have not opted in to marketing',
  consent_pending: 'Their opt-in was never confirmed',
  consent_unknown: 'Shopify had no consent state for them',
  consent_lookup_failed: 'Could not reach Shopify to check consent',
  email_not_configured: 'No email provider is configured',
  dry_run: 'Test run — nothing was sent',
};

function explainSkip(reason) {
  if (!reason) return null;
  if (SKIP_REASON[reason]) return SKIP_REASON[reason];
  if (reason.startsWith('missing_placeholder:')) {
    const fields = reason.split(':')[1].split(',').join(', ');
    return `The message had a blank where ${fields} should go, so it was held back`;
  }
  return reason;
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '•••';
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

export default async function ActivityPage() {
  const store = await getCurrentStore();

  const messages = await prisma.messageLog.findMany({
    where: { shopId: store.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      enrollment: {
        select: { id: true, workflow: { select: { id: true, name: true } } },
      },
    },
  });

  const counts = await prisma.messageLog.groupBy({
    by: ['status'],
    where: { shopId: store.id },
    _count: { _all: true },
  });

  // Recipient addresses are on this screen, so it is a merchant read of
  // protected customer data — the same rule the preview follows.
  if (messages.length > 0) {
    await logCustomerDataAccess({
      shopId: store.id,
      action: 'ACTIVITY',
      recordCount: messages.length,
      detail: 'message history',
    });
  }

  const total = counts.reduce((sum, row) => sum + row._count._all, 0);

  return (
    <>
      <h1 style={{ fontSize: 20, margin: 0 }}>Activity</h1>
      <p className="sp-card-sub mt-1">
        Every message your automations have sent — and every one they decided not to.
      </p>

      {total === 0 ? (
        <div className="sp-card sp-card-pad mt-4">
          <div className="sp-empty">
            <div className="sp-empty-emoji" aria-hidden="true">
              📬
            </div>
            <div className="sp-empty-title">Nothing sent yet</div>
            <p className="sp-empty-text">
              When an automation is active and a customer places a matching order, what happens to
              them shows up here — including anything held back, and why.
            </p>
            <Link href="/workflows" className="sp-btn mt-3">
              Go to automations
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="d-flex gap-4 flex-wrap mt-4">
            {counts.map((row) => (
              <div key={row.status}>
                <div style={{ fontSize: 22, fontWeight: 640 }}>{row._count._all}</div>
                <div className="sp-label mb-0 mt-1">{STATUS[row.status]?.label ?? row.status}</div>
              </div>
            ))}
          </div>

          <div className="sp-card mt-3">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>To</th>
                  <th>Message</th>
                  <th>What happened</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((message) => {
                  const status = STATUS[message.status] ?? { label: message.status, tone: 'neutral' };
                  const reason = explainSkip(message.skipReason);

                  return (
                    <tr key={message.id}>
                      <td className="sp-help" style={{ whiteSpace: 'nowrap' }}>
                        {(message.sentAt ?? message.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                      </td>
                      <td>{maskEmail(message.recipient)}</td>
                      <td>
                        {message.subject || '—'}
                        {message.enrollment?.workflow && (
                          <div className="sp-help">
                            <Link href={`/workflows/${message.enrollment.workflow.id}`}>
                              {message.enrollment.workflow.name}
                            </Link>
                          </div>
                        )}
                      </td>
                      <td>
                        <span className={`sp-pill ${status.tone}`}>{status.label}</span>
                        {reason && <div className="sp-help mt-1">{reason}</div>}
                        {message.error && (
                          <div className="sp-help mt-1" style={{ color: 'var(--sp-critical)' }}>
                            {message.error}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {total > messages.length && (
            <div className="sp-help mt-2">
              Showing the most recent {messages.length} of {total}.
            </div>
          )}
        </>
      )}
    </>
  );
}
