import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import InstallForm from '@/components/InstallForm';
import { isConfigured } from '@/lib/env';
import { getCurrentStore } from '@/lib/session';
import { normalizeShopDomain } from '@/lib/shopify/auth';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  // A verified shop means middleware checked an App Bridge session token, so
  // this request came from inside the Shopify admin. Send it into the app even
  // when no Store row exists yet: under managed installation the merchant is
  // granted access without passing through our OAuth callback, and the row is
  // created by the token exchange in the (app) layout. Requiring the row here
  // would strand every first-time merchant on the marketing page, since the
  // only route that can create it is the one they are being kept from.
  const headerList = await headers();
  if (normalizeShopDomain(headerList.get('x-pulseflow-shop'))) redirect('/workflows');

  // Not embedded: a returning merchant with a valid session cookie still skips
  // the marketing page, but an unknown visitor sees it.
  const store = await getCurrentStore({ autoInstall: false });
  if (store && !store.uninstalledAt) redirect('/workflows');

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="sp-card sp-card-pad" style={{ maxWidth: 520, width: '100%' }}>
        <div className="sp-brand-mark" aria-hidden="true">◈</div>
        <h1 className="mt-3" style={{ fontSize: 22 }}>
          Describe an automation. Watch it run.
        </h1>
        <p className="sp-card-sub mt-2" style={{ lineHeight: 1.6 }}>
          Say what you want in a sentence — &ldquo;email customers 30 days after their first
          purchase with 10% off&rdquo; — and PulseFlow writes it out as a workflow you can read and
          edit. Nothing is sent until you approve it.
        </p>
        <hr className="sp-divider" />
        <InstallForm configured={isConfigured()} />
      </div>
    </main>
  );
}
