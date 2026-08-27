'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '@/lib/utils/fetchJson';

/**
 * Activate, pause, and stop journeys in flight.
 *
 * Activation is the moment real messages become possible, so it asks first.
 * The confirmation is not ceremony: this is the step the brief's second hard
 * rule is about, and the merchant should have to mean it.
 */
export default function WorkflowActions({ workflowId, status, inFlight }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [confirming, setConfirming] = useState(null);

  async function act(action) {
    setBusy(action);
    setError(null);
    setConfirming(null);

    try {
      await fetchJson(`/api/workflows/${workflowId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      router.refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  if (confirming === 'activate') {
    return (
      <div className="sp-card sp-card-pad" style={{ maxWidth: 380 }}>
        <div className="sp-card-title">Turn this on?</div>
        <p className="sp-card-sub mt-2">
          From now on, customers who place a matching order will enter this automation and will
          receive real emails. Customers who ordered before now are not affected.
        </p>
        <div className="d-flex gap-2 mt-3">
          <button className="sp-btn sp-btn-primary" onClick={() => act('activate')} disabled={busy}>
            {busy ? 'Activating…' : 'Yes, activate'}
          </button>
          <button className="sp-btn" onClick={() => setConfirming(null)} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (confirming === 'cancel-enrollments') {
    return (
      <div className="sp-card sp-card-pad" style={{ maxWidth: 380 }}>
        <div className="sp-card-title">Stop {inFlight} customer{inFlight === 1 ? '' : 's'} in progress?</div>
        <p className="sp-card-sub mt-2">
          They will not receive the rest of this automation. This cannot be undone — they would have
          to enter again by placing a new order.
        </p>
        <div className="d-flex gap-2 mt-3">
          <button className="sp-btn sp-btn-primary" onClick={() => act('cancel-enrollments')} disabled={busy}>
            {busy ? 'Stopping…' : 'Stop them'}
          </button>
          <button className="sp-btn" onClick={() => setConfirming(null)} disabled={busy}>
            Keep going
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="text-end">
      <div className="d-flex gap-2 flex-wrap justify-content-end">
        {status !== 'ACTIVE' && (
          <button className="sp-btn sp-btn-primary" onClick={() => setConfirming('activate')} disabled={busy}>
            Activate
          </button>
        )}

        {status === 'ACTIVE' && (
          <button className="sp-btn" onClick={() => act('pause')} disabled={busy}>
            {busy === 'pause' ? 'Pausing…' : 'Pause'}
          </button>
        )}

        {inFlight > 0 && (
          <button className="sp-btn" onClick={() => setConfirming('cancel-enrollments')} disabled={busy}>
            Stop {inFlight} in progress
          </button>
        )}
      </div>

      {status === 'ACTIVE' && (
        <div className="sp-help mt-2" style={{ maxWidth: 280 }}>
          Pausing stops new customers entering. Anyone already inside carries on.
        </div>
      )}

      {error && (
        <div className="sp-help mt-2" style={{ color: 'var(--sp-critical)', maxWidth: 280 }}>
          {error}
        </div>
      )}
    </div>
  );
}
