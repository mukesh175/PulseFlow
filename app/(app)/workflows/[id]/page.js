import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getCurrentStore } from '@/lib/session';
import { describeDefinition, describeTrigger } from '@/lib/workflows/describe';
import WorkflowHeader from '@/components/workflows/WorkflowHeader';
import WorkflowActions from '@/components/workflows/WorkflowActions';
import PreviewPanel from '@/components/workflows/PreviewPanel';
import { attributionFor } from '@/lib/workflows/attribution';

export const dynamic = 'force-dynamic';

const STATE_LABEL = {
  WAITING: 'Waiting',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  EXITED: 'Left early',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

export default async function WorkflowDetailPage({ params }) {
  const { id } = await params;
  const store = await getCurrentStore();

  // Scoped to the store, so a guessed id from another shop is a 404 rather
  // than someone else's automation.
  const workflow = await prisma.workflow.findFirst({ where: { id, shopId: store.id } });
  if (!workflow) notFound();

  const [byState, messages, discounts, attribution] = await Promise.all([
    prisma.enrollment.groupBy({
      by: ['state'],
      where: { workflowId: workflow.id },
      _count: { _all: true },
    }),
    prisma.messageLog.count({ where: { enrollment: { workflowId: workflow.id }, status: 'SENT' } }),
    prisma.discountGrant.count({ where: { enrollment: { workflowId: workflow.id } } }),
    attributionFor({ shopId: store.id, workflowId: workflow.id }),
  ]);

  const steps = describeDefinition(workflow.definition);
  const totalEnrollments = byState.reduce((sum, row) => sum + row._count._all, 0);
  const inFlight = byState
    .filter((row) => row.state === 'WAITING' || row.state === 'RUNNING')
    .reduce((sum, row) => sum + row._count._all, 0);

  return (
    <>
      <Link href="/workflows" className="sp-card-sub">
        ← All automations
      </Link>

      <WorkflowHeader
        workflowId={workflow.id}
        name={workflow.name}
        status={workflow.status}
        version={workflow.version}
        definition={workflow.definition}
        enrollments={totalEnrollments}
      />

      <div className="d-flex justify-content-end mt-3">
        <WorkflowActions workflowId={workflow.id} status={workflow.status} inFlight={inFlight} />
      </div>

      <div className="sp-card sp-card-pad mt-4" style={{ maxWidth: 720 }}>
        <div className="sp-card-title">What it does</div>
        <div className="sp-card-sub mt-1">{describeTrigger(workflow.definition)}</div>
        <hr className="sp-divider" />
        <ol style={{ paddingLeft: 18, fontSize: 14.5, lineHeight: 1.9, color: 'var(--sp-ink-2)', margin: 0 }}>
          {steps.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </div>

      {workflow.status === 'DRAFT' && (
        <PreviewPanel definition={workflow.definition} />
      )}

      <div className="sp-card sp-card-pad mt-3" style={{ maxWidth: 720 }}>
        <div className="sp-card-title">Customers</div>
        {byState.length === 0 ? (
          <p className="sp-card-sub mt-2 mb-0">
            Nobody has entered this automation yet. Customers join when they place an order that
            matches the trigger.
          </p>
        ) : (
          <>
            <table className="sp-table mt-2">
              <tbody>
                {byState.map((row) => (
                  <tr key={row.state}>
                    <td>{STATE_LABEL[row.state] ?? row.state}</td>
                    <td style={{ textAlign: 'right' }}>{row._count._all}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sp-help mt-3">
              {messages} email{messages === 1 ? '' : 's'} delivered · {discounts} discount code
              {discounts === 1 ? '' : 's'} issued
            </div>
          </>
        )}
      </div>

      {attribution.messagesSent > 0 && (
        <div className="sp-card sp-card-pad mt-3" style={{ maxWidth: 720 }}>
          <div className="sp-card-title">What it brought in</div>
          <div className="sp-card-sub mt-1">Last {attribution.days} days, net of refunds.</div>
          <hr className="sp-divider" />

          <div className="d-flex gap-4 flex-wrap">
            <div>
              <div style={{ fontSize: 22, fontWeight: 640 }}>
                {money(attribution.direct.revenue, store.currency)}
              </div>
              <div className="sp-label mb-0 mt-1">Directly</div>
              <div className="sp-help" style={{ maxWidth: 260 }}>
                {attribution.direct.orders} order{attribution.direct.orders === 1 ? '' : 's'} that used a
                code this automation issued.
              </div>
            </div>

            <div>
              <div style={{ fontSize: 22, fontWeight: 640, color: 'var(--sp-muted)' }}>
                {money(attribution.influenced.revenue, store.currency)}
              </div>
              <div className="sp-label mb-0 mt-1">Possibly influenced</div>
              <div className="sp-help" style={{ maxWidth: 260 }}>
                {attribution.influenced.orders} order{attribution.influenced.orders === 1 ? '' : 's'} placed
                within {attribution.windowDays} days of a message, without using a code.
              </div>
            </div>
          </div>

          {/* Said plainly, because the second number is the one a merchant will
              be tempted to treat as earnings. */}
          <div className="sp-help mt-3">
            Only the first number is a fact. The second is a correlation — some of those customers
            would have ordered anyway.
          </div>
        </div>
      )}
    </>
  );
}

function money(amount, currency) {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: currency || 'USD' }).format(amount);
  } catch {
    return `${amount}`;
  }
}
