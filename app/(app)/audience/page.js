import Link from 'next/link';
import prisma from '@/lib/prisma';
import { getCurrentStore } from '@/lib/session';
import { describeStep } from '@/lib/workflows/describe';
import { logCustomerDataAccess } from '@/lib/audit';

export const dynamic = 'force-dynamic';

/**
 * Who is inside an automation right now, and where they have got to.
 *
 * The Activity screen answers "what did you send?". This answers "what is about
 * to happen?" — which is the question a merchant has before they change or pause
 * something, and the one they cannot answer from a list of past messages.
 */

const STATE = {
  WAITING: { label: 'Waiting', tone: 'info' },
  RUNNING: { label: 'Running now', tone: 'info' },
  COMPLETED: { label: 'Finished', tone: 'success' },
  EXITED: { label: 'Left early', tone: 'neutral' },
  CANCELLED: { label: 'Stopped', tone: 'neutral' },
  FAILED: { label: 'Failed', tone: 'critical' },
};

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return '•••';
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

/**
 * What happens next for this person.
 *
 * Read from the snapshot they entered on, not the workflow's current
 * definition — otherwise this screen would describe a journey they are not
 * actually on, which is exactly the confusion versioning exists to prevent.
 */
function nextStepFor(enrollment) {
  const steps = enrollment.snapshot?.definition?.steps ?? [];
  const step = steps[enrollment.currentStepIndex];
  if (!step) return 'Finishing up';
  return describeStep(step);
}

export default async function AudiencePage() {
  const store = await getCurrentStore();

  const enrollments = await prisma.enrollment.findMany({
    where: { shopId: store.id },
    orderBy: [{ state: 'asc' }, { nextRunAt: 'asc' }],
    take: 100,
    include: {
      workflow: { select: { id: true, name: true } },
      snapshot: { select: { definition: true, version: true } },
    },
  });

  const counts = await prisma.enrollment.groupBy({
    by: ['state'],
    where: { shopId: store.id },
    _count: { _all: true },
  });

  // Customer addresses are on this screen, so it is a merchant read of
  // protected customer data — the same rule the preview and Activity follow.
  if (enrollments.length > 0) {
    await logCustomerDataAccess({
      shopId: store.id,
      action: 'AUDIENCE',
      recordCount: enrollments.length,
      detail: 'customers in automations',
    });
  }

  const total = counts.reduce((sum, row) => sum + row._count._all, 0);
  const inFlight = counts
    .filter((row) => row.state === 'WAITING' || row.state === 'RUNNING')
    .reduce((sum, row) => sum + row._count._all, 0);

  return (
    <>
      <h1 style={{ fontSize: 20, margin: 0 }}>Audience</h1>
      <p className="sp-card-sub mt-1">
        Everyone who has entered an automation, and what happens to them next.
      </p>

      {total === 0 ? (
        <div className="sp-card sp-card-pad mt-4">
          <div className="sp-empty">
            <div className="sp-empty-emoji" aria-hidden="true">
              👥
            </div>
            <div className="sp-empty-title">Nobody is in an automation yet</div>
            <p className="sp-empty-text">
              Customers join when they place an order that matches an active automation&apos;s
              trigger. They appear here with the step they are waiting on.
            </p>
            <Link href="/workflows" className="sp-btn mt-3">
              Go to automations
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="d-flex gap-4 flex-wrap mt-4">
            <div>
              <div style={{ fontSize: 22, fontWeight: 640 }}>{inFlight}</div>
              <div className="sp-label mb-0 mt-1">In progress right now</div>
            </div>
            {counts
              .filter((row) => row.state !== 'WAITING' && row.state !== 'RUNNING')
              .map((row) => (
                <div key={row.state}>
                  <div style={{ fontSize: 22, fontWeight: 640, color: 'var(--sp-muted)' }}>
                    {row._count._all}
                  </div>
                  <div className="sp-label mb-0 mt-1">{STATE[row.state]?.label ?? row.state}</div>
                </div>
              ))}
          </div>

          <div className="sp-card mt-3">
            <table className="sp-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Automation</th>
                  <th>Next</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {enrollments.map((enrollment) => {
                  const state = STATE[enrollment.state] ?? { label: enrollment.state, tone: 'neutral' };
                  const running = enrollment.state === 'WAITING' || enrollment.state === 'RUNNING';

                  return (
                    <tr key={enrollment.id}>
                      <td>{maskEmail(enrollment.customerEmail)}</td>
                      <td>
                        <Link href={`/workflows/${enrollment.workflow.id}`} style={{ color: 'inherit' }}>
                          {enrollment.workflow.name}
                        </Link>
                        <div className="sp-help">v{enrollment.snapshot?.version ?? '?'}</div>
                      </td>
                      <td>
                        {running ? (
                          nextStepFor(enrollment)
                        ) : (
                          <span className={`sp-pill ${state.tone}`}>{state.label}</span>
                        )}
                      </td>
                      <td className="sp-help" style={{ whiteSpace: 'nowrap' }}>
                        {running && enrollment.nextRunAt
                          ? enrollment.nextRunAt.toISOString().slice(0, 10)
                          : (enrollment.completedAt ?? enrollment.enrolledAt).toISOString().slice(0, 10)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {total > enrollments.length && (
            <div className="sp-help mt-2">
              Showing {enrollments.length} of {total}.
            </div>
          )}
        </>
      )}
    </>
  );
}
