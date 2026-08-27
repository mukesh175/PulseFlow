'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '@/lib/utils/fetchJson';

/**
 * Edit an automation's steps.
 *
 * Scoped to what a merchant actually changes after reading their automation
 * back: the wording of a message, the length of a wait, the size of a discount.
 * Steps can be removed but not added or reordered — that needs a builder, and
 * shipping a half-built one would be worse than saying plainly what this does.
 *
 * Saving creates a new version. Customers already inside keep running the
 * version they entered on, so editing cannot rewrite a journey in progress.
 */
export default function StepEditor({ workflowId, definition, version, onDone }) {
  const router = useRouter();
  const [steps, setSteps] = useState(() => structuredClone(definition.steps));
  const [state, setState] = useState({ busy: false, error: null, fieldErrors: [] });

  function update(index, patch) {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function remove(index) {
    setSteps((current) => current.filter((_, i) => i !== index));
  }

  async function save() {
    setState({ busy: true, error: null, fieldErrors: [] });

    try {
      const result = await fetchJson(`/api/workflows/${workflowId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save-definition', definition: { ...definition, steps } }),
      });
      onDone?.(result.version);
      router.refresh();
    } catch (error) {
      // The validator's messages name the step and say what was expected, so
      // they are shown as-is rather than replaced with something vaguer.
      setState({ busy: false, error: error.message, fieldErrors: error.data?.errors ?? [] });
    }
  }

  return (
    <div className="sp-card sp-card-pad mt-3" style={{ maxWidth: 720 }}>
      <div className="sp-card-title">Edit steps</div>
      <div className="sp-card-sub mt-1">
        Saving creates version {version + 1}. Customers already partway through this automation
        carry on with the version they started, so nothing changes underneath them.
      </div>
      <hr className="sp-divider" />

      <div className="d-flex flex-column gap-3">
        {steps.map((step, index) => (
          <div key={index} className="sp-card sp-card-pad" style={{ background: 'var(--sp-canvas)', boxShadow: 'none' }}>
            <div className="d-flex justify-content-between align-items-start gap-2">
              <div className="sp-label mb-0">
                {index + 1}. {LABEL[step.type] ?? step.type}
              </div>
              <button
                type="button"
                className="sp-btn sp-btn-sm"
                onClick={() => remove(index)}
                disabled={state.busy}
              >
                Remove
              </button>
            </div>

            <div className="mt-2">
              <StepFields step={step} onChange={(patch) => update(index, patch)} disabled={state.busy} />
            </div>
          </div>
        ))}
      </div>

      {steps.length === 0 && (
        <p className="sp-card-sub">Every step has been removed. Add one back before saving.</p>
      )}

      {state.error && (
        <div className="sp-help mt-3" style={{ color: 'var(--sp-critical)' }}>
          {state.error}
          {state.fieldErrors.length > 0 && (
            <ul className="mt-1 mb-0" style={{ paddingLeft: 18 }}>
              {state.fieldErrors.map((problem, i) => (
                <li key={i}>{problem.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="d-flex gap-2 mt-3 flex-wrap">
        <button className="sp-btn sp-btn-primary" onClick={save} disabled={state.busy || steps.length === 0}>
          {state.busy ? 'Saving…' : `Save as version ${version + 1}`}
        </button>
        <button className="sp-btn" onClick={() => onDone?.(null)} disabled={state.busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const LABEL = {
  wait: 'Wait',
  condition: 'Only continue if',
  send_email: 'Send an email',
  create_discount: 'Create a discount',
};

function StepFields({ step, onChange, disabled }) {
  if (step.type === 'wait') {
    return (
      <>
        <label className="sp-label" htmlFor={`days-${step.days}`}>
          Days
        </label>
        <input
          className="sp-input"
          type="number"
          min={1}
          max={365}
          value={step.days}
          disabled={disabled}
          onChange={(e) => onChange({ days: Number(e.target.value) })}
          style={{ width: 120 }}
        />
        {/* Said here rather than only in the validator's rejection, so the
            merchant does not have to fail a save to learn it. */}
        <div className="sp-help mt-1">Whole days only. Automations run once a day.</div>
      </>
    );
  }

  if (step.type === 'condition') {
    return (
      <div className="sp-card-sub">
        {step.check === 'has_not_ordered_since_enrollment'
          ? 'They have not ordered again since entering this automation.'
          : 'The discount created earlier is still unused.'}
        <div className="sp-help mt-1">Conditions cannot be changed yet — remove it, or leave it as it is.</div>
      </div>
    );
  }

  if (step.type === 'send_email') {
    return (
      <>
        <label className="sp-label">Subject</label>
        <input
          className="sp-input"
          value={step.subject}
          maxLength={200}
          disabled={disabled}
          onChange={(e) => onChange({ subject: e.target.value })}
        />

        <label className="sp-label mt-2">Message</label>
        <textarea
          className="sp-input"
          rows={5}
          value={step.body}
          maxLength={10000}
          disabled={disabled}
          onChange={(e) => onChange({ body: e.target.value })}
        />
        <div className="sp-help mt-1">
          You can use <code>{'{{discount_code}}'}</code>, <code>{'{{customer_name}}'}</code> and{' '}
          <code>{'{{store_name}}'}</code>. An unsubscribe link is added automatically.
        </div>
      </>
    );
  }

  if (step.type === 'create_discount') {
    return (
      <div className="d-flex gap-3 flex-wrap">
        <div>
          <label className="sp-label">Percentage off</label>
          <input
            className="sp-input"
            type="number"
            min={1}
            max={100}
            value={step.percentage ?? ''}
            disabled={disabled}
            onChange={(e) => onChange({ percentage: Number(e.target.value) })}
            style={{ width: 120 }}
          />
        </div>
        <div>
          <label className="sp-label">Valid for (days)</label>
          <input
            className="sp-input"
            type="number"
            min={1}
            max={365}
            value={step.expiresInDays}
            disabled={disabled}
            onChange={(e) => onChange({ expiresInDays: Number(e.target.value) })}
            style={{ width: 140 }}
          />
        </div>
      </div>
    );
  }

  return null;
}
