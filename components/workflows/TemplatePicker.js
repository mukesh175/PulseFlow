'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchJson } from '@/lib/utils/fetchJson';

export default function TemplatePicker({ templates }) {
  const router = useRouter();
  const [selected, setSelected] = useState(templates[0]?.id ?? null);
  const [name, setName] = useState(templates[0]?.name ?? '');
  const [state, setState] = useState({ saving: false, error: null });

  function choose(template) {
    setSelected(template.id);
    // Follow the template name unless the merchant has typed something of their
    // own, so switching templates does not silently discard a chosen name.
    const previous = templates.find((t) => t.id === selected);
    if (!name || name === previous?.name) setName(template.name);
  }

  async function create(event) {
    event.preventDefault();
    setState({ saving: true, error: null });

    try {
      const { id } = await fetchJson('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: selected, name }),
      });
      router.push(`/workflows/${id}`);
    } catch (error) {
      setState({ saving: false, error: error.message });
    }
  }

  return (
    <form onSubmit={create} className="mt-4" style={{ maxWidth: 720 }}>
      <div className="d-flex flex-column gap-3">
        {templates.map((template) => {
          const active = template.id === selected;
          return (
            <button
              type="button"
              key={template.id}
              onClick={() => choose(template)}
              className="sp-card sp-card-pad text-start"
              style={{
                border: `1px solid ${active ? 'var(--sp-brand)' : 'var(--sp-line)'}`,
                background: active ? 'var(--sp-brand-soft)' : 'var(--sp-surface)',
                cursor: 'pointer',
                width: '100%',
              }}
              aria-pressed={active}
            >
              <div className="sp-card-title">{template.name}</div>
              <div className="sp-card-sub mt-1">{template.summary}</div>

              <ol className="mt-3 mb-0" style={{ paddingLeft: 18, fontSize: 13.5, color: 'var(--sp-ink-2)' }}>
                {template.steps.map((step, index) => (
                  <li key={index} style={{ marginBottom: 4 }}>
                    {step}
                  </li>
                ))}
              </ol>

              <div className="sp-help mt-3">{template.detail}</div>
            </button>
          );
        })}
      </div>

      <div className="sp-card sp-card-pad mt-3">
        <label className="sp-label" htmlFor="name">
          Name it
        </label>
        <input
          id="name"
          className="sp-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
        />
        <div className="sp-help mt-1">Only you see this. It is how the automation appears in your list.</div>

        {state.error && (
          <div className="sp-help mt-3" style={{ color: 'var(--sp-critical)' }}>
            {state.error}
          </div>
        )}

        <button className="sp-btn sp-btn-primary mt-3" type="submit" disabled={state.saving || !selected}>
          {state.saving ? 'Creating…' : 'Create as draft'}
        </button>
        <div className="sp-help mt-2">Nothing is sent yet. You will see who it would reach on the next screen.</div>
      </div>
    </form>
  );
}
