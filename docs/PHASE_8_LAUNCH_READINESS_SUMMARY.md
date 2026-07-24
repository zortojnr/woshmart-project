# Woshmart — Phase 8: Launch Readiness Summary

Per `BUILD_SCRIPT.md` Phase 8 items 1 and 4. Companion docs: `docs/PHASE_8_STAGING_E2E_WALKTHROUGH.md` (item 2) and `docs/PHASE_8_PRODUCTION_CUTOVER.md` (item 3, prepared but not executed).

## 1. WhatsApp message template approval status

**Straight answer: there is no record anywhere in this repo of any of the four templates having actually been submitted to Meta.** `BUILD_SCRIPT.md`'s Phase 8 checklist phrasing ("submitted back in Phase 0") doesn't match what Phase 0's actual walkthrough (`docs/PHASE_0_WALKTHROUGH.md` §2) or `docs/BUILD_LOG.md`'s Phase 0 completion record describe — Phase 0 covers submitting the **WhatsApp Business Profile/number** for approval, which is a different Meta review from submitting individual **message templates**. I have no Meta Business Manager or Twilio Console access, so I can't check live approval status directly — you've told me the production number itself is still pending business verification, which I'm treating as the current ground truth rather than re-deriving it.

**Why this matters more than a simple status check, and what I found checking the actual code:**

WhatsApp's rule is: a business can send free-text messages to a customer only within 24 hours of that customer's own last inbound message to the business ("the session window"). Outside that window, a business-initiated message requires a pre-approved message template (Twilio's Content API, a `contentSid`) — a plain-text send gets rejected. I checked `src/messaging/send.service.ts` and `src/domain/notifications/notification.service.ts` directly: **every single outbound message in this codebase, to the customer or to Woshman/partners, goes out as plain free text via `sendMessage({ to, body })`. There is no `contentSid`/Content API usage anywhere.**

Mapped against the four named templates, and the session-window rule (measured from the *customer's* last message, not any Woshman/partner activity — those are separate phone numbers/threads entirely):

| Template | Currently sent as | Realistic session-window risk |
|---|---|---|
| Order confirmation | Free text, immediately after the customer's own `YES` | Low — this fires as a direct reply within the same customer-initiated exchange. |
| Delivery notice | Free text (`notify('DELIVERED', ...)`) | **Real risk.** Delivery can happen hours after the customer's last message (they place the order, then say nothing until it arrives) — easily outside 24h in normal turnaround. |
| Feedback nudge | Free text, sent in the *same call* as the delivery notice (`notification.service.ts`'s `DELIVERED` case sends both back to back) | **Same real risk** — it's not a separate later nudge, it's fired at the identical moment as the delivery notice. |
| Stale-session nudge | **Doesn't exist in code yet** — it's an explicit Phase 9+ backlog item (`BUILD_SCRIPT.md`'s Phase 9+ list: "Stale-session nudge job using approved templates") | N/A for this launch, but worth noting the Phase 8 checklist asks about approval status for a feature that isn't built — the checklist item is checking ahead of the actual dependency. |

**This is a real production-readiness gap, not just a pending-approval status.** Even once the number clears Meta's business verification and templates could theoretically be submitted, the delivery notice and feedback prompt would still fail in production as currently coded if they ever fire outside the customer's session window — which, given real order turnaround times, will happen regularly, not as an edge case. Per this phase's own scope ("verification, not architecture"), I'm reporting this rather than building the Content API integration — but it should be treated as a blocking pre-launch item, not a nice-to-have, once the number itself is approved.

**Recommended sequencing** (for you to confirm, not something I'm deciding): (1) number clears Meta business verification, (2) submit templates for delivery notice and feedback nudge specifically — order confirmation likely doesn't need one given the timing, but check Meta's actual template requirements rather than assuming, (3) wire the approved template SIDs into `notification.service.ts`'s `DELIVERED` case via Twilio's Content API before this ever runs against real, unsupervised customer traffic. Flagging this as a dependency to track, not blocking Phase 8's other verification work on it, per your instruction.

## 2. Monitoring/alerting readiness (for second-person review before go-live)

| Category | Status | Detail |
|---|---|---|
| **API fully down** | Ready, pending your dashboard action | `/health` checks both DB and Redis. Render's "Health Check Failed" + "Deploy Failed" notifications need to be enabled in the dashboard (steps in `docs/SECURITY.md` §3.10) — not yet confirmed done. |
| **DB unreachable** | Ready, pending your dashboard action | Same section — Render's native "Database unavailable" notification, needs enabling per instance. |
| **Payment/data-integrity issues** | **Built and verified end-to-end with a real send** | `src/lib/alertEmail.ts` fires only when the `payment-abandon` job dead-letters. Confirmed structurally impossible to fire on a single transient failure (the send call sits inside the exhausted-retries branch, not reachable otherwise) and confirmed with a real, non-mocked email delivery earlier this session. |
| **Error tracking** | **Wired and confirmed with real Sentry capture** | `src/lib/sentry.ts`, real DSN now configured both locally and on staging; a live, non-mocked test error was triggered and you confirmed it captured Sentry-side. Production still needs its own DSN decision (same project with environment tagging, or a separate project — see `docs/PHASE_8_PRODUCTION_CUTOVER.md` §3) once production exists. |
| **Rate limiting (as a monitoring signal, not just a control)** | Built, not yet observed under real load | Per-phone/global webhook limits and per-admin/IP Admin API limits log a `warn` on every trip (`src/webhooks/rateLimit.middleware.ts`, `src/admin-api/middleware/rateLimit.middleware.ts`) — worth watching Retool/logs for these specifically during the Phase 8a pilot, since real usage patterns are the actual validation of the threshold reasoning documented in-code, not just the math done in advance. |
| **Backups** | **Not ready — real, active gap** | Staging is on Render's free tier with no native backups and a hard 44-day deletion clock (`docs/SECURITY.md` §3.9) — mitigated by the custom `pg_dump`→B2 pipeline, but that's a compensating control, not the real thing. Production **must** be on a paid Postgres plan from day one (called out explicitly in `docs/PHASE_8_PRODUCTION_CUTOVER.md` §1) — this is not optional for launch. |
| **Alert-threshold sanity (CLAUDE.md's "trends, not single events" philosophy)** | Reasoned through, not yet load-tested | The rate-limit thresholds' math is documented in-code (`rateLimit.middleware.ts`) as reasonable headroom over expected volume, but "reasonable at design time" and "correct under real traffic" aren't the same claim — Phase 8a's supervised pilot is the first real chance to observe this, not something further to simulate here. |

**For the second-person reviewer this item asks for:** the two Render-dashboard items (health-check and DB-unavailable notifications) are the concrete, checkable "is this actually on" items — everything else above already has either a real end-to-end test behind it or an honestly-stated gap. Don't take "monitoring is ready" as a single yes/no; it's ready in the areas with real verification and explicitly not ready on backups until production is provisioned correctly.

## Stopping here

Per item 5 and CLAUDE.md's manual-production-promotion rule: nothing in `docs/PHASE_8_PRODUCTION_CUTOVER.md` has been executed — no production Postgres/Redis/Web Service provisioned, no JWT secret generated, no production admin seeded, no Twilio webhook pointed at anything. That checklist is prepared for you to run yourself, deliberately, step by step.
