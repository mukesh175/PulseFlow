import LegalPage, { LegalSection } from '@/components/LegalPage';

export const metadata = {
  title: 'Privacy policy — PulseFlow',
  description: 'What personal data PulseFlow processes, why, who it contacts, and how long it is kept.',
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro="PulseFlow runs automations for a Shopify merchant: it waits, checks conditions, and sends messages to that merchant's customers. Unlike an analytics or monitoring app, it contacts customers directly. This page describes exactly which personal data the app reads, what it does with it, and how long it keeps it. It is written to match what the application actually does."
    >
      <LegalSection title="Who this covers">
        <p>
          PulseFlow is installed by a Shopify merchant on their own store. The merchant is the data controller for
          their customers&apos; personal data; PulseFlow acts as a data processor on the merchant&apos;s behalf, and
          processes personal data only to run the automations that merchant has created and activated.
        </p>
        <p>
          PulseFlow never sends anything on its own initiative. An automation is a draft until the merchant
          explicitly activates it, and no message is sent to any customer before that.
        </p>
      </LegalSection>

      <LegalSection title="What personal data we process">
        <p>PulseFlow reads two protected customer fields from the Shopify Admin API:</p>
        <ul>
          <li>
            <strong>Customer email</strong> — the address an automation sends to, and the identity an enrollment is
            keyed on.
          </li>
          <li>
            <strong>Customer name</strong> — used to address the message.
          </li>
        </ul>
        <p>
          We also read each customer&apos;s <strong>email marketing consent state</strong> from Shopify. We do{' '}
          <strong>not</strong> read phone numbers, shipping or billing addresses, payment details, or browsing
          behaviour. We do not use tracking pixels or third-party analytics inside the app.
        </p>
        <p>
          Alongside this we process non-personal store data: order totals, line items, currency, fulfillment and
          financial status, refund amounts, and the shop&apos;s timezone.
        </p>
      </LegalSection>

      <LegalSection title="Why we process it, and what we send">
        <p>
          Solely to run the automations the merchant has written and activated — for example, emailing a customer a
          set number of days after their first order, and issuing a discount code to that customer.
        </p>
        <p>
          Messages are sent on behalf of the merchant, about that merchant&apos;s store, to that merchant&apos;s own
          customers. PulseFlow does not send messages about itself, does not market to customers on its own behalf,
          and does not contact a customer of one store on behalf of another.
        </p>
        <p>
          We do not sell personal data, share it with advertisers, use it to train machine-learning models, or use it
          for any purpose other than operating PulseFlow for the merchant.
        </p>
      </LegalSection>

      <LegalSection title="Consent and unsubscribing">
        <p>
          Marketing consent is checked against Shopify <strong>at the moment of sending</strong>, not when the
          customer entered the automation. A customer who withdraws consent during a thirty-day wait is not sent the
          message at the end of it. Where consent is absent or has been withdrawn, the send is recorded as skipped,
          with the reason, and nothing is delivered.
        </p>
        <p>
          Every message carries an unsubscribe link resolving to that individual customer for that individual store.
          Unsubscribing stops all further PulseFlow messages to that person from that store immediately, and is
          independent of any other store they may have bought from.
        </p>
      </LegalSection>

      <LegalSection title="Automated decisions">
        <p>
          Automations are deterministic: the merchant writes the rules, and the app follows them. Where an automation
          is created from a description in plain language, that description is compiled once into a workflow the
          merchant can read and edit before activating it. No model decides at run time who receives a message.
        </p>
        <p>
          The decisions involved — whether to send a message, whether to issue a discount code — have no legal or
          similarly significant effect on the customer.
        </p>
      </LegalSection>

      <LegalSection title="Where it is stored">
        <p>
          Data is stored in a PostgreSQL database hosted by Neon, and the application runs on Vercel. Email is
          delivered by Resend. All three are subprocessors acting under contract. Data is encrypted in transit (TLS)
          and at rest, including backups.
        </p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <p>
          A deletion pass runs daily and removes anything past the periods below. These are enforced in code, not
          only stated here.
        </p>
        <ul>
          <li>
            <strong>Raw webhook payloads: 30 days</strong> (90 days if the delivery failed and is still being
            diagnosed). These contain the most customer data and are the shortest-lived thing we hold.
          </li>
          <li>
            <strong>Records of messages sent and discount codes issued: 12 months</strong>, so a merchant can answer
            a customer asking why they received something.
          </li>
          <li>
            <strong>Completed automations: 12 months</strong> after the customer entered them.
          </li>
          <li>
            <strong>Mirrored orders: 24 months.</strong>
          </li>
          <li>
            <strong>Access logs: 12 months.</strong>
          </li>
          <li>
            <strong>Unsubscribe records are kept indefinitely</strong> and are the one exception. An unsubscribe is a
            standing instruction, not stale data: deleting it as old would allow a later automation to email someone
            who had asked us to stop. It is removed only when the person asks for their record itself to be erased.
          </li>
          <li>
            When the app is uninstalled, the access token is destroyed immediately, every automation is paused, and
            every customer waiting inside one is cancelled. Nothing further is sent, including on reinstall.
          </li>
          <li>
            When Shopify sends <code>shop/redact</code> (48 hours after uninstall), the store record and every
            related row — orders, automations, enrollments, message records, discount records — is permanently
            deleted.
          </li>
          <li>
            When Shopify sends <code>customers/redact</code> for an individual, any automation that person is inside
            is cancelled first, then their email and name are erased. The record that a message was sent is retained
            without the address it was sent to.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Access logging">
        <p>
          Reads of customer name and email are recorded in an access log: what was accessed, how many records, and
          whether it was a merchant viewing a screen or an automated job. The log records the fact of access, never
          the personal data itself. Merchants can see their own log in the app, under Settings.
        </p>
      </LegalSection>

      <LegalSection title="Individual rights">
        <p>
          Requests from a customer should be made to the merchant who operates the store. Shopify forwards those
          requests to us automatically, and PulseFlow responds to <code>customers/data_request</code>,{' '}
          <code>customers/redact</code> and <code>shop/redact</code> without manual intervention.
        </p>
        <p>
          A customer who only wants to stop receiving messages does not need to make a request: the unsubscribe link
          in any message is immediate and needs no account or login.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about this policy or about data PulseFlow holds: contact the app developer through the Shopify
          App Store listing, or at the support address given there.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
