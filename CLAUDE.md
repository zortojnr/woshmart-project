# CLAUDE.md

This file is read by Claude Code at the start of every session in this repo. Follow it exactly. If something here conflicts with a request in chat, follow this file and flag the conflict — don't silently pick one.

## What this project is

Woshmart — a WhatsApp-based laundry ordering and operations system. Customers order entirely through WhatsApp (via Twilio). Operations run through a Retool admin dashboard talking to our API. No payment gateway (bank transfer + cash on delivery only, manually verified). No customer mobile/web app. No third-party workflow-automation tool — all logic lives in this codebase.

Full context lives in `/docs`:
- `docs/SETUP_GUIDE.md` — everything to configure before Phase 0 starts. **Read and complete this before giving Claude Code the first prompt.**
- `docs/PHASE_0_WALKTHROUGH.md` — click-by-click companion to Phase 0: exact steps for Twilio, Meta, local Postgres/Redis, repo setup
- `docs/PRD.md` — what we're building and why, business rules, message copy, pricing
- `docs/TRD.md` — technical requirements, stack, API design, non-functional requirements
- `docs/ARCHITECTURE.md` — system diagram, data flow, folder structure
- `docs/DATABASE_SCHEMA.md` — full schema reference (source of truth for `prisma/schema.prisma`)
- `docs/USER_JOURNEY.md` — end-to-end flows for every actor (customer, Woshman, partner, COO)
- `docs/SECURITY.md` — threat model, controls, incident response, vulnerability disclosure. Read this in full before Phase 7 of the build, and treat any conflict between this and code as a bug.
- `docs/IMPLEMENTATION_PLAN.md` — roadmap view: phases, dependencies, what's deferred and why
- `docs/BUILD_SCRIPT.md` — the phased build plan with a ready-to-use prompt per phase. **Work through this in order. Do not skip phases.**
- `docs/BUILD_LOG.md` — phase completion tracker. **Update this on every merge.**

Read `docs/PRD.md` and `docs/ARCHITECTURE.md` before writing any code in a new session if you don't already have them in context. Don't guess at business rules or message copy — they're specified exactly and copying them wrong is a real defect, not a style choice.

## Tech stack (do not substitute without flagging it)

- Node.js LTS, TypeScript (strict mode)
- Express (not NestJS — deliberately, see TRD.md)
- Prisma + PostgreSQL
- Redis + BullMQ for jobs/queues
- Zod for validation
- Pino for logging
- Vitest (or Jest) + Supertest for testing
- Twilio SDK for WhatsApp send + webhook signature validation

## Non-negotiable rules

These are gates, not suggestions. If you're about to violate one, stop and say so instead of proceeding.

1. **Every webhook route validates the Twilio signature before doing anything else.** Use the Twilio SDK's official validator. No route touching `/webhooks/twilio/*` ships without this active and tested against a real signed payload.
2. **No secret is ever written to a file that gets committed.** `.env` is gitignored. Only `.env.example` (names, no values) is committed. If you ever need a real secret value to test something, ask — don't invent a placeholder and don't hardcode a real one "temporarily."
3. **Money is always an integer (kobo), never a float.** `BIGINT` in the schema, integer arithmetic in code. Reject any PR-equivalent change that introduces currency as `NUMERIC`/`float`.
4. **Order status transitions go through one validated function**, never a raw `UPDATE`/`.update()` on `orders.status` anywhere else — not in the Admin API, not in the keyword parser, not in a script. Illegal transitions (e.g. `picked_up` before `paid`/`assigned`) are rejected, not silently allowed.
5. **Only one code path sends WhatsApp messages** — the Messaging Service. The conversation engine, keyword parser, Admin API, and timeout jobs all call the Notification Service, which calls the Messaging Service. Nothing calls Twilio's send API directly from anywhere else.
6. **Every mutation is idempotent.** Webhook retries, job retries, and double-clicks from Retool must all be safe to repeat. Check `MessageSid`/equivalent uniqueness before processing, and design job handlers assuming they might run twice.
7. **Message copy is copied exactly from `docs/PRD.md`, not rewritten.** If wording seems off, flag it — don't "improve" it silently. Keep copy (`conversation/messages.ts`) and logic (state handlers) in separate files so copy can be reviewed independently.
8. **Every Admin API write is audit-logged** via the shared middleware, no exceptions for "small" endpoints.
9. **No feature is "done" without its failure mode stated.** Before considering a task complete, answer: what happens if the network call fails, the input is malformed, the event arrives twice, or the downstream service is slow? If you don't know, it's not done.
10. **Don't add infrastructure the BUILD_SCRIPT.md hasn't called for.** No new services, no new external dependencies, no "just in case" abstraction layers. If you think something's genuinely needed beyond what's scoped, say so and wait for confirmation before building it.

## Alerting / failure philosophy

Design every failure path so nothing needs a human at 2AM unless it genuinely can't wait:
- Transient failures (network blips, Twilio 5xx, DB hiccups) retry with backoff automatically, silently, no alert on first occurrence.
- Alert on trends (backlog growing, failure rate spiking), not single events.
- Reserve urgent alerts for: API fully down, DB unreachable, payment/data-integrity issues. Everything else surfaces in Retool/logs for business-hours review.
- If something fails after retries are exhausted, log it loudly and make it visible in the admin dashboard — don't drop it silently and don't page anyone over it.

## Workflow expectations

- **Never add Claude as a co-author on commits in this repo.** No `Co-Authored-By: Claude` trailer, regardless of the default commit workflow.
- **Git identity for this repo is `zortojnr` / `zortorichard27@gmail.com`.** Do not commit as `InfoKW` / `info@kelliworks.com` — that account should not be used to author commits or open PRs on this project. If the local git config or `gh auth` drifts back to it, fix it before committing/opening a PR rather than proceeding.
- Work through `docs/BUILD_SCRIPT.md` phase by phase, in order, using the ready-to-use prompt provided for each phase. Each phase has an exit criteria — meet it before starting the next phase.
- **Branch per phase.** Name it `phase-N-<short-name>`. Never commit directly to `main`.
- **PR per phase (or per meaningful unit of work within a large phase).** Open a PR against `main` with a description covering what was built, what was tested, and what's explicitly deferred. Include manual test transcripts/evidence where the phase calls for a manual staging test.
- **CI must be green before merge. This is necessary, not sufficient.** CI catches typos and broken tests — it does not catch logic bugs, security bypasses, or math errors nobody wrote a test for. Green CI is the minimum bar, not the signal that the work is trustworthy.
- **A human reviews and approves every PR before merge. Claude Code never merges its own work, ever, regardless of how confident the summary is.** Stop after opening the PR and wait. See `docs/SECURITY.md` §7 and the phase-specific "must personally verify" items below for what the reviewer should actually scrutinize, not just skim.
- **Update `docs/BUILD_LOG.md` as part of the merge**, not as a separate afterthought step: mark the phase's row complete, link the merged PR, note the date. If a phase spans multiple PRs, log each one.
- Check off the individual task checkboxes in `docs/BUILD_SCRIPT.md` itself as they're completed, so progress is visible mid-phase too, not just at merge.
- Write tests alongside the code they cover, not as an afterthought pass at the end. Prioritize tests on: money math, state transition legality, webhook signature validation, idempotency. These are the things that actually cause damage if wrong — and are also exactly the things a human reviewer should re-verify by reading the code, not by trusting that a test exists.
- Keep commits scoped and described — one logical change per commit, message explains *why* not just *what*.
- If a business rule in `docs/PRD.md` seems ambiguous or contradictory once you're implementing it, stop and ask rather than guessing — these are real operational rules (refund policy, cancellation windows, etc.), not cosmetic details.

## Phases that require real human scrutiny, not a skim

Green CI and a plausible-sounding PR description are not sufficient sign-off for these. The reviewer should read the actual code, not just the summary, for:

- **Phase 1 — webhook signature validation.** A subtle bug here means anyone on the internet can inject fake orders or fake status updates. Read the validation logic line by line; don't just trust that a passing test exists — confirm the test actually exercises a tampered request and a genuinely-signed one, not two variations of the same mocked payload.
- **Phase 3 — the order state machine and pricing math.** Read the legal-transition table implementation directly against `TRD.md` §9. Manually recompute at least a few quote calculations (a bundle, a boundary case on the free-logistics threshold) against `PRD.md` §6 by hand and compare to what the code produces.
- **Phase 5 — admin auth and RBAC.** Don't trust "tests pass" here. Manually log in as each role (or read the RBAC middleware directly) and confirm a `viewer` token is actually rejected on a write route, not just hidden in the Retool UI.
- **Phase 7 — the security hardening summary.** Spot-check at least two or three of Claude Code's "confirmed correct" claims yourself rather than accepting the summary at face value.

If the person reviewing doesn't have the technical background to do this personally, get someone who does before merging these specific phases — this is the one place where "the docs were detailed" isn't a substitute for a second set of eyes that actually understands the code.

## Things to never do

- Never build a payment gateway integration — explicitly out of scope. `payment_method` supports `transfer` and `cod` only for now (schema should stay extensible per TRD.md, but don't build the extension speculatively).
- Never build an admin panel outside Retool — the Admin API is Retool's backend, not a separate frontend.
- Never use `n8n` or any third-party workflow-automation tool — all orchestration logic lives in this Node backend.
- Never let the conversation engine or any handler talk to Postgres or Twilio directly — always through the service layer (`domain/*`, `messaging/*`).
- Never skip the Phase 0 / Phase 1 foundation work to "get to the interesting part faster" — the webhook signature validation and idempotency plumbing is the highest-priority security control in the system and everything else depends on it being solid.
