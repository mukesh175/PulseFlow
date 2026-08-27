import prisma from '@/lib/prisma';
import { verifyUnsubscribeToken, suppress } from '@/lib/unsubscribe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Per-customer unsubscribe. Public: no account, no login, no Shopify session.
 *
 * **A GET must not unsubscribe anyone.** Mail providers, security scanners and
 * link previewers fetch every URL in a message before a human sees it. If GET
 * acted, those fetches would silently opt people out of mail they still wanted,
 * and the merchant would watch their list drain with no explanation. So GET
 * renders a page with a button, and the button POSTs.
 *
 * The exception is RFC 8058 one-click: a mail client that shows its own
 * unsubscribe button POSTs here directly, which is why `List-Unsubscribe-Post`
 * is set on outgoing messages. That is a deliberate action by a person, and it
 * arrives as a POST, so it works without weakening the rule.
 *
 * Both verbs are deliberately vague about whether the address was already
 * unsubscribed or whether the store exists. This URL is reachable by anyone
 * holding a token, and it should not become a way to test which addresses a
 * merchant has.
 */

export async function GET(request) {
  const token = new URL(request.url).searchParams.get('token');
  const claim = verifyUnsubscribeToken(token);

  if (!claim) return html(invalidPage(), 400);

  const store = await prisma.store.findUnique({
    where: { id: claim.shopId },
    select: { shopName: true, shopDomain: true },
  });

  return html(confirmPage({ token, storeName: store?.shopName || store?.shopDomain || 'this store' }));
}

export async function POST(request) {
  // The token can arrive in the query string (our own form, and one-click,
  // both keep it there) or in the form body.
  const url = new URL(request.url);
  let token = url.searchParams.get('token');

  if (!token) {
    const form = await request.formData().catch(() => null);
    token = form?.get('token') ?? null;
  }

  const claim = verifyUnsubscribeToken(token);
  if (!claim) return html(invalidPage(), 400);

  const store = await prisma.store.findUnique({
    where: { id: claim.shopId },
    select: { id: true, shopName: true, shopDomain: true },
  });

  // A token for a store that no longer exists still gets a success page. There
  // is nothing left to send them, which is what they asked for.
  if (store) {
    await suppress({ shopId: store.id, email: claim.email, reason: 'unsubscribed' });

    // Stop anything already in flight for this person, so a journey mid-wait
    // does not deliver its next message.
    await prisma.enrollment.updateMany({
      where: { shopId: store.id, customerEmail: claim.email, state: { in: ['WAITING', 'RUNNING'] } },
      data: { state: 'CANCELLED', nextRunAt: null, lockedUntil: null, lockedBy: null },
    });
  }

  return html(donePage({ storeName: store?.shopName || store?.shopDomain || 'this store', email: claim.email }));
}

// ---------------------------------------------------------------------------

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // Nothing here should be indexed or followed.
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shell(inner) {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>Unsubscribe</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f1729;padding:24px">
<div style="max-width:440px;width:100%;background:#fff;border-radius:14px;padding:32px;text-align:center">
${inner}
</div>
</body></html>`;
}

function confirmPage({ token, storeName }) {
  return shell(`
<h1 style="font-size:20px;margin:0 0 12px">Unsubscribe from ${escapeHtml(storeName)}?</h1>
<p style="margin:0 0 24px;font-size:14.5px;line-height:1.7;color:#33405a">
You will stop receiving marketing emails from this store. Order confirmations and
other messages the store sends directly are not affected.
</p>
<form method="POST" action="/unsubscribe?token=${encodeURIComponent(token)}">
  <button type="submit" style="width:100%;padding:12px 16px;font-size:15px;font-weight:600;color:#fff;background:#3d5afe;border:0;border-radius:10px;cursor:pointer">
    Yes, unsubscribe me
  </button>
</form>`);
}

function donePage({ storeName, email }) {
  return shell(`
<h1 style="font-size:20px;margin:0 0 12px">You have been unsubscribed</h1>
<p style="margin:0;font-size:14.5px;line-height:1.7;color:#33405a">
${escapeHtml(email)} will no longer receive marketing emails from ${escapeHtml(storeName)}.
</p>`);
}

function invalidPage() {
  return shell(`
<h1 style="font-size:20px;margin:0 0 12px">This link is not valid</h1>
<p style="margin:0;font-size:14.5px;line-height:1.7;color:#33405a">
It may have been altered or truncated by your email client. Try opening the
original link again, or contact the store directly.
</p>`);
}
