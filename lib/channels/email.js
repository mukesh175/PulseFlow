import { env } from '@/lib/env';
import { checkMarketingConsent } from '@/lib/shopify/consent';
import { isSuppressed, unsubscribeUrl } from '@/lib/unsubscribe';

/**
 * The real email channel.
 *
 * Three things stand between a step and a person's inbox, checked in this
 * order: our own suppression list, Shopify's marketing consent, then the
 * provider. Suppression is first because it is a local read and because it is
 * the strongest signal — a person who told us to stop should not have their
 * consent re-examined, and should not cost an API call to refuse.
 *
 * A refusal returns SKIPPED with a reason rather than throwing. The journey
 * continues, and the reason lands on the message record, because "why didn't my
 * customer get this?" is the question a merchant will actually ask.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export function createEmailChannel({ createDiscount } = {}) {
  return {
    sendEmail,
    // Discounts are phase 5. Whatever the caller supplies is used; nothing here
    // pretends to create one.
    createDiscount,
  };
}

async function sendEmail({ store, recipient, subject, body, preheader, enrollmentId }) {
  if (await isSuppressed({ shopId: store.id, email: recipient })) {
    return { status: 'SKIPPED', skipReason: 'unsubscribed' };
  }

  const consent = await checkMarketingConsent(store, recipient);
  if (!consent.allowed) {
    return { status: 'SKIPPED', skipReason: consent.reason };
  }

  if (!env.resendApiKey) {
    // Not an error worth failing a journey over, but not a send either. Saying
    // so plainly beats a SENT record for a message that never left.
    return { status: 'SKIPPED', skipReason: 'email_not_configured' };
  }

  const unsubscribe = unsubscribeUrl({ shopId: store.id, email: recipient });
  const from = senderFor(store);

  let response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json',
        // Idempotency at the provider, on top of our own dedupeKey. If we send
        // and then fail before recording it, this stops the retry becoming a
        // second delivery on Resend's side too.
        'Idempotency-Key': `${enrollmentId}:${subject}`.slice(0, 256),
      },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject,
        html: renderHtml({ body, preheader, unsubscribe, store }),
        text: renderText({ body, unsubscribe }),
        headers: {
          // RFC 8058. The Post variant is what makes a mail client show its own
          // unsubscribe button and call us directly — see the note in the
          // unsubscribe route about why the plain link cannot act on a GET.
          'List-Unsubscribe': `<${unsubscribe}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
  } catch (error) {
    return { status: 'FAILED', error: `Network error contacting the email provider: ${error.message}` };
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      status: 'FAILED',
      error: `Email provider rejected the message (${response.status}): ${payload?.message ?? 'no detail'}`,
    };
  }

  return { status: 'SENT', providerMessageId: payload?.id ?? null };
}

/**
 * Until a merchant verifies their own domain, mail goes out on the shared
 * PulseFlow address and reputation is pooled across stores. The store name is
 * still used as the display name so the customer sees who it is from.
 */
function senderFor(store) {
  if (store.senderVerified && store.senderEmail) {
    return `${store.senderName || store.shopName || 'PulseFlow'} <${store.senderEmail}>`;
  }
  return env.resendFrom;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderHtml({ body, preheader, unsubscribe, store }) {
  const paragraphs = String(body)
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('');

  const hidden = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>`
    : '';

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f7f8fc;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#0f1729">
${hidden}
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:28px">
${paragraphs}
<hr style="border:0;border-top:1px solid #e7eaf0;margin:24px 0" />
<p style="margin:0;font-size:12px;color:#6b7688;line-height:1.6">
You received this because you ordered from ${escapeHtml(store.shopName || store.shopDomain)}.
<br /><a href="${unsubscribe}" style="color:#6b7688">Unsubscribe from these emails</a>
</p>
</div>
</body></html>`;
}

function renderText({ body, unsubscribe }) {
  return `${body}\n\n—\nUnsubscribe: ${unsubscribe}`;
}
