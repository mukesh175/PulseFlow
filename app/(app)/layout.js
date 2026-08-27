import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getCurrentStore } from '@/lib/session';
import { needsReconnect } from '@/lib/shopify/token';
import { SidebarNav, MobileNav } from '@/components/navigation/NavLinks';
import SessionTokenBridge from '@/components/SessionTokenBridge';
import ReconnectBanner from '@/components/ui/ReconnectBanner';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }) {
  const store = await getCurrentStore();

  // Sending an embedded request back to "/" renders the marketing page inside
  // the Shopify admin. Bounce instead: App Bridge mints a fresh session token
  // and returns here with it.
  if (!store) {
    const headerList = await headers();
    const path = headerList.get('x-invoke-path') || '/workflows';
    redirect(`/session-token-bounce?shopify-reload=${encodeURIComponent(path)}`);
  }

  return (
    <div className="sp-shell">
      <SessionTokenBridge />

      <aside className="sp-sidebar">
        <div className="sp-brand">
          <span className="sp-brand-mark" aria-hidden="true">
            ◈
          </span>
          PulseFlow
        </div>
        <SidebarNav />
      </aside>

      <div className="sp-main">
        <header className="sp-topbar">
          <span className="sp-store-chip">
            <span className="dot" aria-hidden="true" />
            {store.shopName || store.shopDomain}
          </span>
        </header>

        <div className="sp-content">
          {needsReconnect(store) && <ReconnectBanner shopDomain={store.shopDomain} />}
          {children}
        </div>
      </div>

      <MobileNav />
    </div>
  );
}
