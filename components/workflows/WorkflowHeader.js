'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '@/lib/utils/fetchJson';
import StatusPill from '@/components/workflows/StatusPill';
import StepEditor from '@/components/workflows/StepEditor';

/**
 * Name, status, and the destructive actions.
 *
 * Delete asks differently depending on what the automation has done, because
 * the two outcomes are genuinely different: an untouched draft is removed, and
 * one that has reached customers is archived so the record of what was sent
 * survives. Telling a merchant "deleted" in both cases would be a lie in one of
 * them.
 */
export default function WorkflowHeader({ workflowId, name, status, version, definition, enrollments }) {
  const router = useRouter();
  const [editingName, setEditingName] = useState(false);
  const [editingSteps, setEditingSteps] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [state, setState] = useState({ busy: false, error: null });

  const willArchive = enrollments > 0;

  async function rename(event) {
    event.preventDefault();
    setState({ busy: true, error: null });
    try {
      await fetchJson(`/api/workflows/${workflowId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', name: draftName }),
      });
      setEditingName(false);
      setState({ busy: false, error: null });
      router.refresh();
    } catch (error) {
      setState({ busy: false, error: error.message });
    }
  }

  async function remove() {
    setState({ busy: true, error: null });
    try {
      await fetchJson(`/api/workflows/${workflowId}`, { method: 'DELETE' });
      router.push('/workflows');
      router.refresh();
    } catch (error) {
      setState({ busy: false, error: error.message });
      setConfirmingDelete(false);
    }
  }

  return (
    <>
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mt-2">
        <div>
          {editingName ? (
            <form onSubmit={rename} className="d-flex gap-2 align-items-center flex-wrap">
              <input
                className="sp-input"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                maxLength={120}
                style={{ width: 280 }}
                autoFocus
                required
              />
              <button className="sp-btn sp-btn-primary sp-btn-sm" type="submit" disabled={state.busy}>
                Save
              </button>
              <button
                type="button"
                className="sp-btn sp-btn-sm"
                onClick={() => {
                  setDraftName(name);
                  setEditingName(false);
                }}
                disabled={state.busy}
              >
                Cancel
              </button>
            </form>
          ) : (
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <h1 style={{ fontSize: 20, margin: 0 }}>{name}</h1>
              <button className="sp-btn sp-btn-sm" onClick={() => setEditingName(true)}>
                Rename
              </button>
            </div>
          )}

          <div className="d-flex align-items-center gap-2 mt-2">
            <StatusPill status={status} />
            <span className="sp-card-sub">version {version}</span>
          </div>
        </div>

        <div className="d-flex gap-2 flex-wrap justify-content-end">
          {!editingSteps && (
            <button className="sp-btn" onClick={() => setEditingSteps(true)}>
              Edit steps
            </button>
          )}
          <button className="sp-btn" onClick={() => setConfirmingDelete(true)} disabled={state.busy}>
            {willArchive ? 'Archive' : 'Delete'}
          </button>
        </div>
      </div>

      {state.error && (
        <div className="sp-help mt-2" style={{ color: 'var(--sp-critical)' }}>
          {state.error}
        </div>
      )}

      {confirmingDelete && (
        <div className="sp-card sp-card-pad mt-3" style={{ maxWidth: 720 }}>
          <div className="sp-card-title">{willArchive ? 'Archive this automation?' : 'Delete this automation?'}</div>

          {willArchive ? (
            <p className="sp-card-sub mt-2">
              {enrollments} customer{enrollments === 1 ? ' has' : 's have'} been through this
              automation, so it is archived rather than deleted — the record of what was sent to
              them is kept, and you can still answer a customer who asks why they received
              something. Anyone still partway through will be stopped.
            </p>
          ) : (
            <p className="sp-card-sub mt-2">
              Nobody has entered this automation, so there is nothing to keep. This cannot be
              undone.
            </p>
          )}

          <div className="d-flex gap-2 mt-3">
            <button className="sp-btn sp-btn-primary" onClick={remove} disabled={state.busy}>
              {state.busy ? 'Working…' : willArchive ? 'Archive it' : 'Delete it'}
            </button>
            <button className="sp-btn" onClick={() => setConfirmingDelete(false)} disabled={state.busy}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {editingSteps && (
        <StepEditor
          workflowId={workflowId}
          definition={definition}
          version={version}
          onDone={() => setEditingSteps(false)}
        />
      )}
    </>
  );
}
