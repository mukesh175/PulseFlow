import { getCurrentStore } from '@/lib/session';
import { needsReconnect } from '@/lib/shopify/token';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

function Row({ label, value, help }) {
  return (
    <div className="d-flex justify-content-between align-items-start gap-3 py-2">
      <div>
        <div className="sp-label mb-0">{label}</div>
        {help && <div className="sp-help mt-1">{help}</div>}
      </div>
      <div style={{ textAlign: 'right', fontSize: 14, color: 'var(--sp-ink-2)' }}>{value}</div>
    </div>
  );
}

export default async function SettingsPage() {
  const store = await getCurrentStore();

  const connected = !needsReconnect(store);
  const sender = store.senderVerified
    ? `${store.senderName || 'PulseFlow'} <${store.senderEmail}>`
    : env.resendFrom;

  return (
    <>
      <h1 style={{ fontSize: 20, margin: 0 }}>Settings</h1>
      <p className="sp-card-sub mt-1">How PulseFlow is connected to {store.shopDomain}.</p>

      <div className="sp-card sp-card-pad mt-4" style={{ maxWidth: 720 }}>
        <div className="sp-card-title">Shopify connection</div>
        <hr className="sp-divider" />
        <Row label="Store" value={store.shopName || store.shopDomain} />
        <Row label="Currency" value={store.currency} />
        <Row
          label="Timezone"
          value={store.timezone}
          help="Waits are measured in your store's timezone, so 'after 30 days' means the same thing to you as it does to your customer."
        />
        <Row
          label="Credentials"
          value={connected ? 'Connected' : 'Needs reconnecting'}
          help="Shopify access tokens last one hour and are refreshed automatically in the background."
        />
      </div>

      <div className="sp-card sp-card-pad mt-3" style={{ maxWidth: 720 }}>
        <div className="sp-card-title">Sending identity</div>
        <hr className="sp-divider" />
        <Row
          label="Messages are sent from"
          value={sender}
          help={
            store.senderVerified
              ? 'Your own verified domain. Your delivery reputation is yours alone.'
              : 'A shared PulseFlow address. Verifying your own domain is not built yet — until it is, delivery reputation is pooled across stores.'
          }
        />
      </div>
    </>
  );
}
