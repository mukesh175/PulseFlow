import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { normalizeShopDomain, generateOAuthState, buildInstallUrl, verifyOAuthHmac } from '@/lib/shopify/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Entry point for installation. Shopify sends the merchant here with
 * ?shop=<store>.myshopify.com (plus hmac when it comes from the Admin).
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const shopDomain = normalizeShopDomain(searchParams.get('shop'));

  if (!shopDomain) {
    return NextResponse.json({ error: 'A valid ?shop=your-store.myshopify.com parameter is required' }, { status: 400 });
  }

  // When Shopify signs the request, the signature must check out.
  if (searchParams.get('hmac') && !verifyOAuthHmac(searchParams)) {
    return NextResponse.json({ error: 'Invalid request signature' }, { status: 401 });
  }

  const state = generateOAuthState();
  await prisma.oAuthState.create({ data: { state, shopDomain } });

  // Housekeeping: states older than an hour can never be redeemed.
  await prisma.oAuthState.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 3600 * 1000) } },
  });

  return NextResponse.redirect(buildInstallUrl(shopDomain, state));
}
