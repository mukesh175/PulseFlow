# StorePulse Automations — project brief

Handoff document for starting the **AI Automation Builder** as a separate app.
Written at the end of the StorePulse build so a fresh session has the context
without re-deriving it.

---

## 1. Why this is a separate app

StorePulse is a **monitoring** app: read-only Shopify scopes, it never contacts
customers, and both its published privacy policy and its Shopify *protected
customer data* declaration say so explicitly ("Marketing or advertising" was
deliberately left unticked).

An automation builder **sends messages and creates discounts**. Bolting it onto
StorePulse would mean:

- new write scopes (`write_discounts`, marketing/customer-consent scopes)
- re-declaring protected customer data use, and re-review
- rewriting the privacy policy and DPA (both currently promise the opposite)
- losing the "read-only" trust position StorePulse has in review

So: **separate app, separate Shopify listing, shared data model.**

## 2. What the new app does

Merchant describes an automation in plain language:

> "Send customers an email 30 days after their first purchase with 10% off."

The app compiles that into an explicit, inspectable workflow:

```
Trigger: order created (customer's first order)
  → Wait 30 days
  → Condition: customer has not ordered again
  → Action: send email
  → Action: create single-use 10% discount
  → Wait 7 days
  → Condition: discount unused
  → Action: send reminder
```

Two hard design rules, both learned from building StorePulse:

1. **The AI writes the workflow, it does not run it.** Natural language is
   compiled once into a stored, versioned workflow definition the merchant can
   read and edit. Nothing at runtime depends on a model being consistent.
2. **Nothing sends without explicit merchant activation.** Draft → preview
   ("this would have matched 84 customers last month") → merchant activates.

## 3. What to reuse from StorePulse

Located at `D:\react\StorePulse` (Next.js 15 App Router, JavaScript, Bootstrap 5,
Prisma + Neon, Vercel).

Worth copying almost verbatim:

| File | Why |
| --- | --- |
| `lib/shopify/auth.js` | OAuth with `expiring=1`, HMAC verification, signed session |
| `lib/shopify/token.js` | Access-token refresh (tokens live 1h, refresh 90d) |
| `lib/shopify/sessionToken.js` | Session token (JWT) verification, Web Crypto |
| `middleware.js` | Session token → cookie, bounce-page redirect |
| `app/session-token-bounce/route.js` | Required for embedded document requests |
| `lib/shopify/client.js` | GraphQL client with throttle/retry and pagination |
| `lib/webhooks/process.js` | Idempotent webhook pattern (unique shop+topic+eventId) |
| `lib/notifications/dispatch.js` | Send-once dedupe via unique `dedupeKey` |
| `lib/audit.js` | Protected customer data access logging |
| `lib/billing.js` | Shopify Billing API + entitlement enforcement |
| `app/globals.css` | The whole design system |

The **alert engine's fingerprint pattern** (`lib/alerts/engine.js`) is the single
most valuable idea to carry over: a deterministic hash of
`type|resourceId|scope` with a unique constraint on `(shopId, fingerprint)`
makes repeat signals collapse into one row. The equivalent here is an
**enrollment fingerprint** — `workflowId + customerId + triggerEventId` — so a
customer can never be enrolled twice by a redelivered webhook.

Data model to extend rather than reinvent: `Store`, `Order`, `OrderLineItem`,
`Product`, `ProductVariant`, `WebhookEvent`, `NotificationLog` all transfer
directly. `lib/segments.js` already computes VIP / at-risk / lost / first-time /
loyal segments from orders — that becomes the audience selector.

## 4. New data model (sketch)

```
Workflow          id, shopId, name, status(DRAFT|ACTIVE|PAUSED), definition Json,
                  version, createdBy, activatedAt
WorkflowVersion   immutable snapshots — never mutate a running definition
Enrollment        id, shopId, workflowId, customerEmail, fingerprint (unique),
                  state, currentStepIndex, nextRunAt, enrolledAt, completedAt
StepRun           enrollmentId, stepIndex, status, scheduledFor, ranAt, error
MessageLog        enrollmentId, channel, dedupeKey (unique), providerMessageId
DiscountGrant     enrollmentId, shopifyPriceRuleId, code, usedAt
```

`Enrollment.nextRunAt` indexed is the scheduler's whole query:
`WHERE nextRunAt <= now() AND state = 'WAITING'`.

## 5. Constraints to design for from day one

- **Consent.** Only email customers with marketing consent from Shopify
  (`emailMarketingConsent.marketingState === 'SUBSCRIBED'`). Check at send time,
  not enrollment time — consent can be withdrawn mid-workflow.
- **Unsubscribe per customer**, not per merchant. StorePulse's `List-Unsubscribe`
  header goes to the *merchant's* settings page; here it must resolve to that
  customer's opt-out.
- **WhatsApp is not a v1 channel.** It needs the WhatsApp Business API and
  per-template approval. Design the channel interface so it can be added, ship
  with email only.
- **Vercel Hobby allows daily crons only.** StorePulse hit this. A workflow
  engine needs minute-level scheduling → either Vercel Pro, or an external
  scheduler (QStash, Inngest, Trigger.dev). **Decide this before writing the
  scheduler**, it shapes the architecture.
- **Idempotency everywhere.** Every send goes through a unique `dedupeKey`, the
  way `NotificationLog` does in StorePulse. A duplicate discount email is much
  worse than a duplicate alert.

## 6. Suggested phasing

1. Auth + embedded shell + data model (mostly copied from StorePulse)
2. Workflow schema and a hand-written JSON workflow executed end to end
3. Scheduler + enrollment engine, with the dry-run preview
4. Email channel with consent checks and unsubscribe
5. Discount actions via Shopify
6. **AI compiler last** — natural language → workflow JSON, validated against
   the schema before it is saved. The engine must be correct before anything
   generates definitions for it.
7. Revenue attribution per workflow (orders within N days of a send)

Building the AI first is the tempting mistake: it demos well and leaves the
executor untested.

## 7. Open questions worth answering before coding

- Which automations do StorePulse merchants actually need? Alert
  resolve/dismiss data will show which problems they care about — wait for real
  usage if possible.
- Same Shopify Partner account and Neon project, or fully separate? (Separate
  database is cleaner for compliance; a shared one avoids a second sync.)
- Does it re-sync orders itself, or read StorePulse's database? Re-syncing is
  more work but keeps the apps independently installable.
