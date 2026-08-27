import { NextResponse } from 'next/server';
import { verifySessionToken, hmacSign } from '@/lib/shopify/sessionToken';

/**
 * Establishes the app session from Shopify's session token.
 *
 * Shopify appends `id_token` to every embedded page load. Verifying it here
 * means authentication is driven by the session token rather than by a
 * third-party cookie — the cookie that follows is only a short-lived carrier
 * for subsequent same-document navigations, and is re-derived from a fresh
 * token on every embedded entry.
 */

/** Recompute the cookie signature to decide whether a session already exists. */
async function hasValidSession(request, sessionSecret) {
  const raw = request.cookies.get('pf_session')?.value;
  if (!raw || !raw.includes('.')) return false;

  const [payload, signature] = raw.split('.');
  try {
    const expected = await hmacSign(sessionSecret, payload);
    if (expected !== signature) return false;
    const data = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return Date.now() - Number(data.iat) < 30 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

export async function middleware(request) {
  const { searchParams, pathname } = request.nextUrl;
  const idToken = searchParams.get('id_token');

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const sessionSecret = process.env.APP_SESSION_SECRET || apiSecret;
  if (!apiKey || !apiSecret) return NextResponse.next();

  if (!idToken) {
    // Embedded document request with no session token and no usable cookie:
    // bounce so App Bridge can mint one. `embedded`/`host` mark the request as
    // coming from the Shopify admin, so ordinary visitors are unaffected.
    const embedded = searchParams.has('embedded') || searchParams.has('host');
    const isDocument = request.headers.get('sec-fetch-dest') === 'document';

    if (embedded && isDocument && !(await hasValidSession(request, sessionSecret))) {
      const target = new URL(request.nextUrl);
      target.searchParams.delete('id_token');

      const bounce = new URL('/session-token-bounce', request.nextUrl.origin);
      bounce.searchParams.set('shopify-reload', `${pathname}${target.search}`);
      return NextResponse.redirect(bounce);
    }

    return NextResponse.next();
  }

  try {
    const { shop } = await verifySessionToken(idToken, { apiKey, apiSecret });

    const payload = btoa(JSON.stringify({ shop, iat: Date.now() }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const signature = await hmacSign(sessionSecret, payload);

    // Forward the verified shop and token so server components can complete a
    // managed installation (token exchange) without another round trip.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-pulseflow-shop', shop);
    requestHeaders.set('x-pulseflow-id-token', idToken);

    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.cookies.set('pf_session', `${payload}.${signature}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      // Shopify renders the app in an iframe, so the cookie must be cross-site.
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
    return response;
  } catch {
    // An invalid token is not fatal — the request falls through to the normal
    // cookie check, and unauthenticated visitors land on the install page.
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    // Everything except static assets and the endpoints that authenticate
    // themselves by HMAC or bearer secret. session-token-bounce is excluded or
    // it would redirect to itself; /unsubscribe is a public customer-facing
    // link and must never be bounced into the Shopify admin.
    '/((?!_next/static|_next/image|favicon.ico|icon.svg|session-token-bounce|unsubscribe|api/webhooks|api/auth|api/cron).*)',
  ],
};
