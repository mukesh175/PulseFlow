import { NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { verifyWebhookHmac, normalizeShopDomain } from '@/lib/shopify/auth';
import { processWebhook } from '@/lib/webhooks/process';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One handler serves every topic. The `[topic]` segment exists so Shopify's
 * dashboard shows a distinct URL per subscription and failures are easy to
 * attribute — but it is never trusted. The topic acted on comes from the
 * `X-Shopify-Topic` header, and only after the HMAC check passes.
 */
export async function POST(request) {
  const rawBody = await request.text();
  const hmac = request.headers.get('x-shopify-hmac-sha256');

  if (!verifyWebhookHmac(rawBody, hmac)) {
    // Do not leak whether the shop exists; a bad signature is always 401.
    return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
  }

  const topic = request.headers.get('x-shopify-topic');
  const shopDomain = normalizeShopDomain(request.headers.get('x-shopify-shop-domain'));
  const eventId =
    request.headers.get('x-shopify-event-id') ||
    crypto.createHash('sha1').update(rawBody).digest('hex');

  if (!topic || !shopDomain) {
    return NextResponse.json({ error: 'Missing Shopify webhook headers' }, { status: 400 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Malformed webhook payload' }, { status: 400 });
  }

  const store = await prisma.store.findUnique({ where: { shopDomain } });

  try {
    const result = await processWebhook({ store, shopDomain, topic, eventId, payload });
    // Always 200 on a verified webhook: Shopify retries on non-2xx, and the
    // event is durably stored either way.
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[pulseflow] webhook processing error', error);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
