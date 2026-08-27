'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '@/lib/utils/fetchJson';

const EXAMPLE = 'Email customers 30 days after their first purchase with 10% off, and remind them a week later if they have not used it.';

/**
 * Describe an automation in a sentence.
 *
 * Two steps, not one: compile, then keep. The merchant reads the steps that
 * came back — in the same plain language the rest of the app uses — before
 * anything is stored. Compiling straight into a saved workflow would make the
 * model's reading of their sentence a fact about their store before they had
 * seen it.
 */
export default function DescribeForm({ configured }) {
  const router = useRouter();
  const [description, setDescription] = useState('');
  const [state, setState] = useState({ busy: false, error: null, result: null });

  async function compile(event) {
    event.preventDefault();
    setState({ busy: true, error: null, result: null });

    try {
      const result = await fetchJson('/api/workflows/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      setState({ busy: false, error: null, result });
    } catch (error) {
      setState({ busy: false, error: error.message, result: null });
    }
  }

  async function keep() {
    setState((s) => ({ ...s, busy: true, error: null }));
    try {
      const { id } = await fetchJson('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: state.result.definition, name: state.result.name }),
      });
      router.push(`/workflows/${id}`);
    } catch (error) {
      setState((s) => ({ ...s, busy: false, error: error.message }));
    }
  }

  if (!configured) return null;

  const { result } = state;

  return (
    <div className="sp-card sp-card-pad" style={{ maxWidth: 720 }}>
      <div className="sp-card-title">Describe it in your own words</div>
      <p className="sp-card-sub mt-1">
        Say what you want to happen. It is written out as steps you can read and change before
        anything is saved.
      </p>

      <form onSubmit={compile} className="mt-3">
        <textarea
          className="sp-input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={EXAMPLE}
          maxLength={2000}
          required
        />
        <div className="d-flex gap-2 align-items-center mt-2 flex-wrap">
          <button className="sp-btn" type="submit" disabled={state.busy || description.trim().length < 10}>
            {state.busy && !result ? 'Writing…' : 'Write it out'}
          </button>
          <button
            type="button"
            className="sp-btn sp-btn-sm"
            onClick={() => setDescription(EXAMPLE)}
            disabled={state.busy}
          >
            Use the example
          </button>
        </div>
      </form>

      {state.error && (
        <div className="sp-help mt-3" style={{ color: 'var(--sp-critical)' }}>
          {state.error}
        </div>
      )}

      {result && (
        <>
          <hr className="sp-divider" />
          <div className="sp-card-title">Here is what that means</div>
          <div className="sp-card-sub mt-1">{result.trigger}</div>

          <ol className="mt-3" style={{ paddingLeft: 18, fontSize: 14.5, lineHeight: 1.9, color: 'var(--sp-ink-2)' }}>
            {result.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>

          <div className="sp-help">
            Read it through. If it is not what you meant, reword your description and write it out
            again — nothing has been saved.
          </div>

          <div className="d-flex gap-2 mt-3 flex-wrap">
            <button className="sp-btn sp-btn-primary" onClick={keep} disabled={state.busy}>
              {state.busy ? 'Saving…' : 'Keep it as a draft'}
            </button>
            <button
              className="sp-btn"
              onClick={() => setState({ busy: false, error: null, result: null })}
              disabled={state.busy}
            >
              Start again
            </button>
          </div>
        </>
      )}
    </div>
  );
}
