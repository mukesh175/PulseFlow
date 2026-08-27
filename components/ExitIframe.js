'use client';

import { useEffect, useState } from 'react';

/**
 * Escape the admin iframe to reach Shopify's OAuth screen, which refuses to be
 * framed.
 *
 * Shopify's iframe permits top-level navigation only with user activation, so
 * an automatic `window.top.location` assignment is silently ignored and the
 * page appears to hang. App review hit exactly that: a spinner that never
 * resolved until the reviewer found the fallback link.
 *
 * The button is therefore the primary path, not a fallback. The automatic
 * attempt still runs for the cases where it is permitted, and the UI never
 * pretends something is happening when it is not.
 */
export default function ExitIframe({ url }) {
  const [autoFailed, setAutoFailed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const embedded = window.top && window.top !== window.self;
    if (!embedded) {
      window.location.href = url;
      return undefined;
    }

    try {
      window.top.location.href = url;
    } catch {
      // Blocked by the iframe — expected without user activation.
    }

    // If the navigation had worked this component would be gone by now.
    const timer = setTimeout(() => setAutoFailed(true), 1200);
    return () => clearTimeout(timer);
  }, [url]);

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="sp-card sp-card-pad text-center" style={{ maxWidth: 460, padding: 32 }}>
        <div className="sp-brand-mark mx-auto" aria-hidden="true" style={{ width: 40, height: 40, fontSize: 20 }}>
          ◈
        </div>

        <h1 className="mt-3" style={{ fontSize: 20 }}>
          Connect PulseFlow to your store
        </h1>
        <p className="sp-card-sub mt-2 mb-0" style={{ lineHeight: 1.6 }}>
          Shopify will ask you to approve the permissions PulseFlow needs. This opens in the main window because
          Shopify&apos;s permission screen cannot run inside the app frame.
        </p>

        {/* target="_top" plus a real click is what actually escapes the iframe. */}
        <a className="sp-btn sp-btn-primary w-100 mt-4" href={url} target="_top" rel="noreferrer">
          Continue to Shopify
        </a>

        {autoFailed && (
          <p className="sp-help mt-3 mb-0">
            Your browser blocked the automatic redirect for security. Use the button above to continue.
          </p>
        )}
      </div>
    </main>
  );
}
