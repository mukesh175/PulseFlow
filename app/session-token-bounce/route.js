import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Session token bounce page.
 *
 * A document request into the embedded app does not always carry a session
 * token — it can be lost through server-side redirects, or the merchant may
 * arrive on a stale URL. Rather than falling back to cookies (blocked as
 * third-party for many merchants) or restarting OAuth, we serve this minimal
 * page. App Bridge loads, obtains a fresh session token, and re-navigates to
 * the URL in `shopify-reload` with `id_token` attached.
 *
 * Deliberately renders no UI: it exists for a fraction of a second.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const reload = searchParams.get('shopify-reload') || '/workflows';

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="shopify-api-key" content="${env.shopifyApiKey}" />
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
    <title>PulseFlow</title>
  </head>
  <body></body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Must never be cached: the whole point is to mint a fresh token.
      'Cache-Control': 'no-store, max-age=0',
      'X-Shopify-Reload': reload,
    },
  });
}
