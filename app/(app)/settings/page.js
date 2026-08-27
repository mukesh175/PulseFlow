import prisma from '@/lib/prisma';
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

const ACCESS_LABEL = {
  PREVIEW: 'Automation preview',
  ACTIVITY: 'Message history viewed',
  ORDER_IMPORT: 'Orders imported from Shopify',
  AUDIENCE: 'Customers in automations viewed',
  ENROLL_BLOCKED: 'Enrollment paused — monthly limit reached',
  CONSENT_CHECK: 'Marketing consent checked before sending',
  DATA_REQUEST: 'Customer data request from Shopify',
  REDACT: 'Customer data erased at Shopify’s request',
};

export default async function SettingsPage() {
  const store = await getCurrentStore();

  const accessLog = await prisma.dataAccessLog.findMany({
    where: { shopId: store.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

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
        <div className="sp-card-title">Data access log</div>
        <div className="sp-card-sub mt-1">
          Every time PulseFlow reads a customer name or email address, it is recorded here — what
          was read, how much, and whether it was you looking at a screen or an automated job. The
          log records that access happened, never the data itself.
        </div>
        <hr className="sp-divider" />

        {accessLog.length === 0 ? (
          <p className="sp-card-sub mb-0">Nothing yet.</p>
        ) : (
          <table className="sp-table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th style={{ textAlign: 'right' }}>Records</th>
              </tr>
            </thead>
            <tbody>
              {accessLog.map((entry) => (
                <tr key={entry.id}>
                  <td className="sp-help">{entry.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    {ACCESS_LABEL[entry.action] ?? entry.action}
                    {entry.detail && <div className="sp-help">{entry.detail}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>{entry.recordCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="sp-help mt-3">Kept for 12 months, then deleted.</div>
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
