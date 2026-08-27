import prisma from '@/lib/prisma';
import { getCurrentStore } from '@/lib/session';

export const dynamic = 'force-dynamic';

const STATUS_LABEL = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  ARCHIVED: 'Archived',
};

export default async function WorkflowsPage() {
  const store = await getCurrentStore();

  const workflows = await prisma.workflow.findMany({
    where: { shopId: store.id, status: { not: 'ARCHIVED' } },
    orderBy: { updatedAt: 'desc' },
    include: { _count: { select: { enrollments: true } } },
  });

  return (
    <>
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-3">
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Automations</h1>
          <p className="sp-card-sub mt-1 mb-0">
            Every automation stays a draft until you activate it. Nothing is sent before then.
          </p>
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="sp-card sp-card-pad mt-4">
          <div className="sp-empty">
            <div className="sp-empty-emoji" aria-hidden="true">
              ⚡
            </div>
            <div className="sp-empty-title">No automations yet</div>
            <p className="sp-empty-text">
              Automations describe what happens after an order: wait, check a condition, send a
              message, offer a discount. You will be able to write one in plain language — for now
              the engine that runs them is still being built.
            </p>
          </div>
        </div>
      ) : (
        <div className="sp-card mt-4">
          <table className="sp-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Version</th>
                <th>Customers enrolled</th>
              </tr>
            </thead>
            <tbody>
              {workflows.map((workflow) => (
                <tr key={workflow.id}>
                  <td>{workflow.name}</td>
                  <td>{STATUS_LABEL[workflow.status] ?? workflow.status}</td>
                  <td>v{workflow.version}</td>
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
