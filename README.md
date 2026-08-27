# PulseFlow

Describe an automation in plain language. PulseFlow compiles it into a workflow
you can read, edit and approve — and nothing is sent to a customer until you
activate it.

A separate app from [StorePulse](../StorePulse) by design: StorePulse is
read-only monitoring and its privacy policy promises it never contacts
customers. PulseFlow sends messages and creates discounts, which needs different
scopes, a different protected-customer-data declaration and a different policy.

## Status

Phase 1 of the [build order](docs/automation-builder-brief.md#6-suggested-phasing):
project setup, Shopify auth, embedded shell, data model. The workflow executor,
the scheduler and the AI compiler are not built yet — the AI compiler is last on
purpose.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run db:migrate
npm run dev
```

`DATABASE_URL` and `DIRECT_URL` come from Neon; `DIRECT_URL` is the non-pooled
connection Prisma migrations need.

## Layout

| Path | What lives there |
| --- | --- |
| `lib/shopify/` | OAuth, expiring-token refresh, session-token verification, throttled GraphQL client |
| `lib/webhooks/` | Idempotent webhook processing, keyed on `(shopDomain, topic, eventId)` |
| `lib/workflows/` | Enrollment fingerprinting |
| `middleware.js` | Session token to cookie, bounce-page redirect |
| `prisma/schema.prisma` | Shopify mirror plus the workflow model |
| `docs/decisions.md` | Why the scheduler, database and sending decisions went the way they did |

## Two rules the code is built around

**The AI writes the workflow, it does not run it.** A definition is compiled
once into stored, versioned JSON. Nothing at runtime depends on a model being
consistent.

**Nothing sends without explicit activation.** Draft, then preview, then the
merchant activates. Every send passes a unique `dedupeKey`, and consent is
checked at send time rather than at enrollment — a customer can withdraw it
halfway through a 30-day wait.
