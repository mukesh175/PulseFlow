import LegalPage, { LegalSection } from '@/components/LegalPage';

export const metadata = {
  title: 'Security — PulseFlow',
  description: 'How PulseFlow protects data, prevents data loss, and responds to a security incident.',
};

export default function SecurityPage() {
  return (
    <LegalPage
      title="Security"
      intro="PulseFlow can email a merchant's customers, so the consequences of a failure here are not abstract. This page describes how access is controlled, how data is protected against loss, and what happens if something goes wrong. It describes the measures actually in place, not aspirations."
    >
      <LegalSection title="Authentication">
        <p>
          Every request into the embedded app carries a Shopify session token, verified by signature before anything
          else happens. Authentication does not depend on third-party cookies, which browsers increasingly block
          inside the Shopify admin.
        </p>
        <p>
          Shopify access tokens expire after one hour and are refreshed automatically. They are stored server-side
          and never reach the browser. Webhook requests are rejected unless their HMAC signature verifies, and the
          scheduler endpoint requires a bearer secret.
        </p>
      </LegalSection>

      <LegalSection title="Access control">
        <p>
          Access to production data is limited to those who need it to operate the service, protected by strong
          passwords and multi-factor authentication on the underlying platform accounts. Reads of customer name and
          email are recorded in an internal access log: what was accessed, how many records, and whether it was a
          merchant viewing a screen or an automated job. The log records the fact of access, never the personal data
          itself.
        </p>
      </LegalSection>

      <LegalSection title="Encryption">
        <p>
          Data is encrypted in transit using TLS and at rest by the database provider, including backups. Secrets and
          API credentials are held as environment variables in the hosting platform and are not committed to source
          control.
        </p>
      </LegalSection>

      <LegalSection title="Separation of test and production data">
        <p>
          Development and production use separate databases. Real merchant data is never copied into a development
          environment; development work runs against a Shopify development store with its own data.
        </p>
      </LegalSection>

      <LegalSection title="Data loss prevention">
        <p>Three things protect against losing data or leaking it:</p>
        <ul>
          <li>
            <strong>Point-in-time recovery.</strong> The database provider retains continuous backups, so the
            database can be restored to a moment before an accidental deletion or a bad migration.
          </li>
          <li>
            <strong>Migrations are versioned and reviewed.</strong> Schema changes are applied through checked-in
            migration files rather than by hand against production.
          </li>
          <li>
            <strong>There is no bulk export path.</strong> The app has no feature that downloads customer lists, and
            no third-party analytics or tracking pixels run inside it. The smaller the number of ways data can leave,
            the fewer there are to secure.
          </li>
        </ul>
        <p>
          Deletion is treated as a first-class operation rather than an afterthought: a daily pass removes data past
          its retention period, and Shopify&apos;s redaction webhooks are handled automatically.
        </p>
      </LegalSection>

      <LegalSection title="Incident response">
        <p>If we become aware of a suspected security incident, we follow these steps in order:</p>
        <ol>
          <li>
            <strong>Contain.</strong> Revoke the affected credentials and, if customer messages could be sent
            incorrectly, pause the scheduler. Stopping sends comes before diagnosis — an unnecessary pause costs a
            delay, a wrong send cannot be recalled.
          </li>
          <li>
            <strong>Assess.</strong> Determine what data was involved, whose it was, and over what period, using the
            webhook, message and access logs.
          </li>
          <li>
            <strong>Notify.</strong> Inform affected merchants without undue delay, and within 72 hours of becoming
            aware where a personal data breach is involved, with what is known, what is not yet known, and what is
            being done. Notify Shopify where the incident concerns data obtained through their APIs.
          </li>
          <li>
            <strong>Remediate.</strong> Fix the cause, rotate any exposed secrets, and restore from backup if data
            was lost.
          </li>
          <li>
            <strong>Review.</strong> Record what happened and what changed as a result.
          </li>
        </ol>
        <p>
          To report a suspected vulnerability or incident, contact the app developer through the Shopify App Store
          listing, or at the support address given there. We would rather hear about a false alarm than not hear
          about a real one.
        </p>
      </LegalSection>

      <LegalSection title="Subprocessors">
        <p>
          Neon hosts the database, Vercel runs the application, and Resend delivers email. Each is a subprocessor
          acting under contract, and each is a company whose own security posture we depend on.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
