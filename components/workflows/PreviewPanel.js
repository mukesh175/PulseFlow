'use client';

import { useState } from 'react';
import { fetchJson } from '@/lib/utils/fetchJson';

/**
 * The dry-run preview, on the draft screen where the decision is made.
 *
 * Deliberately not run automatically on page load: it reads every order in the
 * window, and a merchant opening a list of automations should not trigger that
 * for each one. It is one click, and the click is the merchant asking.
 */
export default function PreviewPanel({ definition }) {
  const [state, setState] = useState({ loading: false, result: null, error: null });
  const [days, setDays] = useState(30);

  async function run() {
    setState({ loading: true, result: null, error: null });
    try {
      const result = await fetchJson('/api/workflows/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition, days }),
      });
      setState({ loading: false, result, error: null });
    } catch (error) {
      setState({ loading: false, result: null, error: error.message });
    }
  }

  const { result } = state;

  return (
    <div className="sp-card sp-card-pad mt-3" style={{ maxWidth: 720 }}>
      <div className="sp-card-title">Who would this have reached?</div>
      <p className="sp-card-sub mt-1">
        Checks your real orders against this automation, without sending anything.
      </p>

      <div className="d-flex gap-2 align-items-end flex-wrap mt-3">
        <div>
          <label className="sp-label" htmlFor="days">
            Look back
          </label>
          <select
            id="days"
            className="sp-input"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            style={{ width: 140 }}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </div>
        <button className="sp-btn" onClick={run} disabled={state.loading}>
          {state.loading ? 'Checking…' : 'Run preview'}
        </button>
      </div>

      {state.error && (
        <div className="sp-help mt-3" style={{ color: 'var(--sp-critical)' }}>
          {state.error}
        </div>
      )}

      {result && (
        <>
          <hr className="sp-divider" />
          <div style={{ fontSize: 15 }}>
            <strong style={{ fontSize: 22 }}>{result.customers}</strong>{' '}
            customer{result.customers === 1 ? '' : 's'} would have entered this automation in the
            last {result.days} days.
          </div>
          <div className="sp-help mt-1">
            From {result.ordersConsidered} order{result.ordersConsidered === 1 ? '' : 's'} in that period.
          </div>

          {result.sample.length > 0 && (
            <table className="sp-table mt-3">
              <tbody>
                {result.sample.map((customer) => (
                  <tr key={customer.email}>
                    <td>{customer.name || 'Customer'}</td>
                    <td className="sp-help">{customer.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* A merchant reading "0 customers" needs to know whether that is a
              fact about their store or about how little history has synced. */}
          {result.coverage.firstOrderDetectionIsApproximate && (
            <div className="sp-banner warning mt-3">
              <span aria-hidden="true">⏳</span>
              <div>
                Only recent orders have synced so far, so &ldquo;first order&rdquo; is an estimate. This
                number will get more accurate as more history arrives.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
