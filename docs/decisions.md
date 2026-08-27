# Decisions

Answers to the open questions in [the brief](automation-builder-brief.md), settled
before phase 1 so the code could depend on them. Each entry records what was
decided and what would have to change to revisit it.

---

## 1. Scheduler: daily cron on Vercel Hobby, revisit at phase 3

**Decided:** stay on Hobby for now. `vercel.json` runs `/api/cron/sweep` once a
day at 03:00 UTC. The endpoint authenticates and reports what is due; it does
not execute anything, because the step executor is phase 3.

The recommendation was Vercel Pro with a minute-level sweep — DB as the sole
source of truth, no second vendor owning the execution graph. That remains the
target. What was deferred is only the $20/month, not the architecture.

**What was built anyway, so deferring costs nothing later:**

- `Enrollment.nextRunAt` with an index on `(state, nextRunAt)` — the sweep query
  is `state = WAITING AND nextRunAt <= now()` and nothing else.
- `Enrollment.lockedUntil` / `lockedBy` — lease columns, present from the first
  migration. Work is claimed in bounded batches by stamping these atomically
  before anything runs, so two overlapping cron invocations cannot send the same
  message twice. Vercel crons are at-least-once; this is not optional.

**Cost of staying on Hobby.** A daily sweep makes "wait 30 days" accurate to the
day and "wait 2 hours" meaningless. Hour-scale steps must therefore stay out of
the workflow schema until the plan changes — a workflow that promises a 2-hour
delay and delivers an 18-hour one is a bug the merchant sees before we do.

**To revisit:** change the cron expression in `vercel.json`. No migration.

## 2. Which automations to ship first

**Decided:** do not wait for StorePulse alert resolve/dismiss telemetry. Ship the
four that are the same in every store and whose audiences `lib/segments.js`
already knows how to compute — first-time to second purchase, post-purchase
winback at 30/60/90 days, VIP thank-you, at-risk reactivation. Real usage data
prioritises v2, it does not gate v1.

## 3. Same Partner account, separate Neon project

**Decided:** same Shopify Partner account, **separate database**.

Compliance is the entire reason this is a second app. If automation data lived
in StorePulse's database, StorePulse's privacy policy — which promises it never
contacts customers — would be contradicted by rows in its own schema, and a
`customers/redact` for one app would have to reason about the other's retention.

## 4. PulseFlow syncs its own orders

**Decided:** own mirror, following from (3). Reading StorePulse's database would
make PulseFlow uninstallable for any merchant who does not also run StorePulse,
and would couple the two release cycles permanently. The cost is a webhook
handler and a backfill, both of which port over nearly verbatim.

---

## Open, and worth settling before phase 4

**Sending identity and deliverability.** The brief treats per-customer
unsubscribe as a data-model requirement; it is also a deliverability one.
Sending every store's mail from one PulseFlow domain pools reputation, so one
merchant with a bad list degrades delivery for everyone. Per-merchant verified
domains fix that but add a DNS step to onboarding before a merchant can send
anything.

`Store.senderEmail` / `senderName` / `senderVerified` exist in the schema and
the settings page reads them, so either answer fits. Nothing verifies a domain
yet — the settings page says so rather than implying otherwise.

## Deviations from the brief worth knowing about

**`customers/redact` is not a no-op.** In StorePulse it was: the app held only
mirrored orders the merchant could already export from the Shopify admin.
PulseFlow holds message history and discount grants that exist nowhere else, so
the handler cancels in-flight enrollments first, then scrubs. Order matters — a
journey left `WAITING` with a nulled recipient would fail in the scheduler
forever.

**Uninstall cancels every enrollment and pauses every workflow.** Without this,
reinstalling three weeks later resumes waits that expired long ago and fires a
burst of stale messages at real customers. Reinstall deliberately does not
un-pause anything.

**Enrollments snapshot their workflow version.** `Enrollment.workflowVersionId`
points at an immutable `WorkflowVersion`, never at the live definition. Editing a
workflow must not rewrite the journey of a customer already halfway through it.
