import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getCurrentStore } from '@/lib/session';
import StatusPill from '@/components/workflows/StatusPill';

export const dynamic = 'force-dynamic';

export default async function WorkflowsPage() {
  const store = await getCurrentStore();

  const workflows = await prisma.workflow.findMany({
    where: { shopId: store.id, status: { not: 'ARCHIVED' } },
    orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    include: {
      _count: { select: { enrollments: true } },
    },
  });

  // One query for the counts that matter on this screen, rather than one per
  // workflow: a merchant with twenty automations should not cost twenty round
  // trips to render a list.
  const active = await prisma.enrollment.groupBy({
    by: ['workflowId'],
    where: { shopId: store.id, state: { in: ['WAITING', 'RUNNING'] } },
    _count: { _all: true },
  });
  const activeByWorkflow = new Map(active.map((row) => [row.workflowId, row._count._all]));

  return (
    <>
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-3">
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Automations</h1>
          <p className="sp-card-sub mt-1 mb-0">
            Every automation stays a draft until you activate it. Nothing is sent before then.
          </p>
        </div>
        <Link href="/workflows/new" className="sp-btn sp-btn-primary">
          New automation
        </Link>
      </div>

      {workflows.length === 0 ? (
        <div className="sp-card sp-card-pad mt-4">
          <div className="sp-empty">
            <div className="sp-empty-emoji" aria-hidden="true">
              ⚡
            </div>
            <div className="sp-empty-title">No automations yet</div>
            <p className="sp-empty-text">
              An automation describes what happens after an order: wait, check a condition, send a
              message, offer a discount. Start from a template and see who it would have reached
              before you turn it on.
            </p>
            <Link href="/workflows/new" className="sp-btn sp-btn-primary mt-3">
              Create your first automation
            </Link>
          </div>
        </div>
      ) : (
        <div className="sp-card mt-4">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>In progress</th>
                <th>Total enrolled</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td>
                    <Link href={`/workflows/${workflow.id}`} style={{ fontWeight: 600, color: 'inherit' }}>
                      {workflow.name}
                    </Link>
                    <div className="sp-help">v{workflow.version}</div>
                  </td>
                  <td>
                    <StatusPill status={workflow.status} />
                  </td>
                  <td>{activeByWorkflow.get(workflow.id) ?? 0}</td>
                  <td>{workflow._count.enrollments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
