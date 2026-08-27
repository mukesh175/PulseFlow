import { redirect } from 'next/navigation';
import InstallForm from '@/components/InstallForm';
import { isConfigured } from '@/lib/env';
import { getCurrentStore } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function LandingPage() {
  // An installed merchant arriving embedded should never see the marketing
  // page — send them straight into the app.
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
