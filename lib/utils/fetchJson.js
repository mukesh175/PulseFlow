/**
 * fetch + JSON with a survivable failure mode.
 *
 * A serverless function that times out or crashes returns the platform's
 * HTML/plain-text error page, not JSON. Calling res.json() on that throws
 * "Unexpected token 'A'…", which tells the merchant nothing. Parse defensively
 * and translate the common platform failures into something actionable.
 */
/**
 * App Bridge exposes a fresh, short-lived session token per call. Sending it
 * as a bearer token is what authenticates embedded requests without relying on
 * third-party cookies. Returns null outside the Shopify admin.
 */
export async function getSessionToken() {
  if (typeof window === 'undefined') return null;
  try {
    const bridge = window.shopify;
    if (bridge?.idToken) return await bridge.idToken();
  } catch {
    // Not embedded, or App Bridge unavailable — cookie auth still applies.
  }
  return null;
}

export async function withAuthHeaders(options = {}) {
  const token = await getSessionToken();
  if (!token) return options;
  return { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } };
}

export async function fetchJson(url, options = {}) {
  const res = await fetch(url, await withAuthHeaders(options));
  const text = await res.text();

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (data === null) {
    if (res.status === 504 || /timed? ?out|FUNCTION_INVOCATION_TIMEOUT/i.test(text)) {
      throw new Error('That took too long and was cut short by the server. Your progress was saved — try again to continue.');
    }
    if (res.status === 413 || res.status === 502 || res.status === 500) {
      throw new Error('The server could not complete this request. Your progress was saved — try again.');
    }
    throw new Error(`Unexpected response from the server (HTTP ${res.status}).`);
  }

  if (!res.ok) {
    const error = new Error(data.error || `Request failed (HTTP ${res.status}).`);
    // The body carries the useful part of a 422 — which field failed and why.
    // Throwing only the summary message meant a caller could show "invalid
    // definition" but never the line that says which step to fix.
    error.status = res.status;
    error.data = data;
    throw error;
  }

  return data;
}
