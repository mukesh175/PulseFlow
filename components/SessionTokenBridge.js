'use client';

import { useEffect } from 'react';
import { getSessionToken } from '@/lib/utils/fetchJson';

/**
 * Confirms the embedded session on every page view by requesting a fresh
 * App Bridge session token and calling an authenticated endpoint with it.
 *
 * Besides keeping the session warm, this guarantees that simply browsing the
 * app produces session-token-authenticated traffic — previously that only
 * happened when the merchant performed an action, which left long stretches
 * with no evidence that the app authenticates this way.
 */
export default function SessionTokenBridge() {
  useEffect(() => {
    let cancelled = false;

    async function confirm() {
      // Give App Bridge a moment to define window.shopify on first paint.
      const token = await getSessionToken();
      if (cancelled) return;

      try {
        await fetch('/api/session/ping', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } catch {
        // Never surface this — it is a background confirmation, not a feature.
      }
    }

    const timer = setTimeout(confirm, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return null;
}
