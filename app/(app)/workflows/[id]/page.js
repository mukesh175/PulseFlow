import Link from 'next/link';
import { notFound } from 'next/navigation';
import prisma from '@/lib/prisma';
import { getCurrentStore } from '@/lib/session';
import { describeDefinition, describeTrigger } from '@/lib/workflows/describe';
import StatusPill from '@/components/workflows/StatusPill';
import WorkflowActions from '@/components/workflows/WorkflowActions';
import PreviewPanel from '@/components/workflows/PreviewPanel';

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

  const [byState, messages, discounts] = await Promise.all([
    prisma.enrollment.groupBy({
      by: ['state'],
      where: { workflowId: workflow.id },
      _count: { _all: true },
    }),
    prisma.messageLog.count({ where: { enrollment: { workflowId: workflow.id }, status: 'SENT' } }),
    prisma.discountGrant.count({ where: { enrollment: { workflowId: workflow.id } } }),
  ]);

  const steps = describeDefinition(workflow.definition);
  const inFlight = byState
    .filter((row) => row.state === 'WAITING' || row.state === 'RUNNING')
    .reduce((sum, row) => sum + row._count._all, 0);

  return (
    <>
      <Link href="/workflows" className="sp-card-sub">
        ← All automations
      </Link>

      <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mt-2">
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>{workflow.name}</h1>
          <div className="d-flex align-items-center gap-2 mt-2">
            <StatusPill status={workflow.status} />
            <span className="sp-card-sub">version {workflow.version}</span>
          </div>
        </div>
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
    </>
  );
}
