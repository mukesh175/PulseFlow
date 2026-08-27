import Link from 'next/link';

export const LAST_UPDATED = '27 August 2026';

/** Shared shell for the public legal pages. */
export default function LegalPage({ title, intro, children }) {
  return (
    <main style={{ minHeight: '100vh', padding: '40px 16px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Link href="/" className="d-inline-flex align-items-center gap-2 mb-4" style={{ color: 'inherit' }}>
          <span className="sp-brand-mark" aria-hidden="true">
            ◈
          </span>
          <strong style={{ fontSize: 17, letterSpacing: '-0.03em' }}>PulseFlow</strong>
        </Link>

        <div className="sp-card sp-card-pad" style={{ padding: 32 }}>
          <h1 style={{ fontSize: 26 }}>{title}</h1>
          <p className="sp-card-sub mt-1">Last updated: {LAST_UPDATED}</p>
          {intro && (
            <p className="mt-3" style={{ fontSize: 15, lineHeight: 1.7, color: 'var(--sp-ink-2)' }}>
              {intro}
            </p>
          )}
          <hr className="sp-divider" />
          <div className="sp-legal-body">{children}</div>
        </div>

        <div className="d-flex gap-3 mt-3 sp-card-sub justify-content-center flex-wrap">
          <Link href="/privacy">Privacy policy</Link>
          <Link href="/terms">Terms &amp; data processing</Link>
          <Link href="/security">Security</Link>
        </div>
      </div>
    </main>
  );
}

export function LegalSection({ title, children }) {
  return (
    <section className="mb-4">
      <h2 style={{ fontSize: 17 }} className="mb-2">
        {title}
      </h2>
      <div style={{ fontSize: 14.5, lineHeight: 1.75, color: 'var(--sp-ink-2)' }}>{children}</div>
    </section>
  );
}
