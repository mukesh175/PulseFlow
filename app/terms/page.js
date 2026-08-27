import LegalPage, { LegalSection } from '@/components/LegalPage';

export const metadata = {
  title: 'Terms & data processing — PulseFlow',
  description:
    'The agreement between PulseFlow and the merchant who installs it, including the data processing terms.',
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & data processing"
      intro="Installing PulseFlow forms an agreement between the merchant and the app developer. This page is both the terms of service and the data processing agreement: PulseFlow processes personal data belonging to the merchant's customers, so the processing terms are part of the same document rather than a separate one nobody reads."
    >
      <LegalSection title="The service">
        <p>
          PulseFlow lets a merchant define automations that run against their own Shopify store — waiting a period,
          checking a condition, sending an email to a customer, and issuing a discount code. Automations are stored
          as explicit, versioned definitions the merchant can read and edit.
        </p>
        <p>
          An automation is a draft until the merchant activates it. Nothing is sent to any customer before that
          activation, and the app never creates or activates an automation on the merchant&apos;s behalf.
        </p>
      </LegalSection>

      <LegalSection title="What the merchant is responsible for">
        <ul>
          <li>
            <strong>The content of messages.</strong> The merchant writes what is sent and is responsible for it
            being accurate, lawful, and appropriate for the recipient.
          </li>
          <li>
            <strong>Having a lawful basis to market to their customers.</strong> PulseFlow enforces Shopify&apos;s
            marketing consent state, but the underlying relationship with the customer is the merchant&apos;s.
          </li>
          <li>
            <strong>The discounts they authorise.</strong> Discount codes are created in the merchant&apos;s Shopify
            store under their own commercial terms.
          </li>
          <li>
            <strong>Their own legal obligations</strong> as the data controller, including responding to requests
            from their customers.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="What we are responsible for">
        <ul>
          <li>Running activated automations as the merchant defined them.</li>
          <li>
            Not sending where consent is absent or has been withdrawn, checked at the moment of sending rather than
            when the customer entered the automation.
          </li>
          <li>Honouring an unsubscribe immediately, for that customer and that store.</li>
          <li>Not sending the same message twice, enforced by a uniqueness constraint rather than by convention.</li>
          <li>Deleting personal data on the schedule set out in the privacy policy.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Data processing terms">
        <p>
          <strong>Roles.</strong> The merchant is the data controller for their customers&apos; personal data. The
          app developer is the data processor, and processes that data only on the merchant&apos;s documented
          instructions — which, in practice, are the automations the merchant has created and activated.
        </p>
        <p>
          <strong>Subject matter and duration.</strong> Processing lasts for as long as the app is installed, plus
          the retention periods in the privacy policy.
        </p>
        <p>
          <strong>Categories of data subject.</strong> Customers of the merchant&apos;s Shopify store who have placed
          an order.
        </p>
        <p>
          <strong>Categories of personal data.</strong> Customer email address, customer name, marketing consent
          state, and order records associated with them. No phone numbers, addresses, or payment details.
        </p>
        <p>
          <strong>Subprocessors.</strong> Neon (database hosting), Vercel (application hosting), and Resend (email
          delivery). Each processes data under its own contractual terms. We will not add a subprocessor that
          changes the categories of data processed without updating this page.
        </p>
        <p>
          <strong>The automation writer.</strong> When a merchant chooses to describe an automation in their own
          words, that description and the store&apos;s name are sent to a language model provider — Anthropic,
          Google or Groq, depending on how the app is configured — which returns the workflow steps. This is the
          only feature that sends anything to a model provider, and it runs only when the merchant uses it.
        </p>
        <p>
          <strong>No customer data is sent to a model provider.</strong> Customer names, email addresses, consent
          state and order history are never part of that request. The model writes the automation; it plays no part
          in running one, and nothing on the sending path calls a model.
        </p>
        <p>
          Where the app is configured against a provider&apos;s free tier, that provider may use the submitted text
          to improve its own services under its terms. The text is the merchant&apos;s description of what they want
          to happen — never their customers&apos; data — but merchants who would rather it were not used that way
          can create automations from templates instead, which sends nothing anywhere.
        </p>
        <p>
          <strong>Security.</strong> Data is encrypted in transit and at rest, including backups. Access to
          production data is limited to those who need it to operate the service. Reads of customer name and email
          are logged.
        </p>
        <p>
          <strong>Assisting the controller.</strong> Requests from a customer — access, erasure — are handled through
          Shopify&apos;s mandatory privacy webhooks, which PulseFlow answers automatically and without manual
          intervention.
        </p>
        <p>
          <strong>Deletion.</strong> On uninstall, the access token is destroyed, every automation is paused, and
          every customer waiting inside one is cancelled. When Shopify sends <code>shop/redact</code>, the store
          record and all related data are permanently deleted.
        </p>
        <p>
          <strong>Breach notification.</strong> If we become aware of a personal data breach affecting a
          merchant&apos;s data, we will notify that merchant without undue delay, with what we know and what we are
          doing about it.
        </p>
      </LegalSection>

      <LegalSection title="What the app does not do">
        <p>
          We do not sell personal data, share it with advertisers, use it to train machine-learning models, or use it
          to market anything of our own to a merchant&apos;s customers. A customer of one store is never contacted on
          behalf of another.
        </p>
      </LegalSection>

      <LegalSection title="Availability and liability">
        <p>
          The service is provided as is. We aim to run automations on schedule, but delivery depends on Shopify,
          on the email provider, and on hosting infrastructure we do not control. Scheduled steps may run later than
          the exact time specified.
        </p>
        <p>
          To the extent permitted by law, liability is limited to the fees paid for the app in the twelve months
          before the claim.
        </p>
      </LegalSection>

      <LegalSection title="Ending the agreement">
        <p>
          The merchant may uninstall at any time, from the Shopify admin, which ends processing immediately. We may
          suspend an account that is being used to send unlawful messages or to contact people who have not
          consented.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms: contact the app developer through the Shopify App Store listing, or at the
          support address given there.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
