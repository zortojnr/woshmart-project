# Woshmart — Build Script

Execute in order. Do not start a phase until the previous phase's exit criteria are met.

**Workflow for every phase (no exceptions — see `CLAUDE.md` §Workflow):**
1. Create a branch: `phase-N-<short-name>` (e.g. `phase-2-conversation-engine-core`)
2. Do the work, committing in logical scoped chunks
3. Open a PR against `main`. PR description lists what was built, what was tested, what's deferred
4. CI must be **green** before merge — but green CI alone is not sign-off. It catches broken tests, not logic bugs, security bypasses, or math errors nobody thought to test.
5. **A human reads the diff and approves before merge.** Claude Code opens the PR and stops — it never merges its own work. For Phases 1, 3, 5, and 7 specifically, see the "must personally verify" list in `CLAUDE.md` — these need a reviewer who actually understands the code, not just a glance at the summary.
6. On merge: update `BUILD_LOG.md` — mark the phase complete, link the PR, note the date
7. Only then start the next phase's branch

Each phase below has a **ready-to-use prompt** — paste it into Claude Code as-is to kick off that phase. Each prompt assumes `CLAUDE.md`, `docs/PRD.md`, `docs/TRD.md`, `docs/ARCHITECTURE.md`, and `docs/DATABASE_SCHEMA.md` are already in the repo and readable.

**A note on what this build script can and can't guarantee:** detailed prompts and phase gates reduce the chance of Claude Code inventing business logic it shouldn't — the spec is precise, so there's little room for it to guess. That is not the same as a guarantee of correct code. This is a real system for real users, not a prototype — the human review step above is not optional overhead, it's the actual safety mechanism. A well-written prompt aims the tool; it doesn't replace someone checking what it built.

---

## Phase 0 — Pre-work

- [ ] Twilio account created, WhatsApp Sandbox active, tested manually (send a message, see it logged)
- [ ] Meta Business Manager account created, WhatsApp Business Profile submitted (multi-day lead time — do this first, don't wait on anything else)
- [ ] Postgres provisioned (dev)
- [ ] Redis provisioned (dev)
- [ ] Repo initialized with folder structure from `ARCHITECTURE.md` §4
- [ ] `.env.example` committed — every required variable name, no values
- [ ] Staging Twilio sender requested/configured (separate from production)

**Exit criteria:** WhatsApp message to the sandbox number produces a raw payload visible in a local log.

> Phase 0 is mostly human/ops setup (Twilio, Meta, infra accounts), not code — Claude Code's part starts with repo scaffolding.

**Prompt for Claude Code — Phase 0 (repo scaffolding only):**
```
Read CLAUDE.md, docs/PRD.md, docs/TRD.md, and docs/ARCHITECTURE.md in full before doing anything.

Set up the repo scaffold for Phase 0 of docs/BUILD_SCRIPT.md:
1. Initialize a Node.js + TypeScript project (strict mode) matching the stack in TRD.md §1.
2. Create the full folder structure exactly as specified in ARCHITECTURE.md §4 (empty
   placeholder files where needed so the structure is real, not just directories).
3. Add package.json with the confirmed dependencies (Express, Prisma, Redis/BullMQ, Zod,
   Pino, Twilio SDK, Vitest or Jest + Supertest) and scripts for dev/build/test/lint/typecheck.
4. Add tsconfig.json (strict mode on).
5. Add ESLint + Prettier config, enforced in a CI workflow (typecheck + lint + test on every PR).
6. Add .env.example listing every variable name from TRD.md / the setup guide, no real values.
7. Add .gitignore covering .env, node_modules, build output.
8. Do NOT write any business logic yet — this phase is scaffolding only.

Work on a branch named phase-0-scaffolding. Open a PR when done, with a description of what
was added. Do not merge it yourself — wait for CI to go green and for review.
```

---

## Phase 1 — Foundation (no business logic yet)

- [ ] Express app skeleton per `ARCHITECTURE.md` §4
- [ ] `config/env.ts` — validated env loading, fails loudly on boot if required vars missing
- [ ] Prisma schema from `docs/DATABASE_SCHEMA.md`, first migration applied to dev DB
- [ ] `/webhooks/twilio/inbound`: signature validation (tested against a real signed sandbox payload, not a mock), `MessageSid` idempotency check, log + save to `messages`, respond `200`
- [ ] `/webhooks/twilio/status`: same idempotency discipline, updates `messages.status`
- [ ] `/health` endpoint — DB + Redis connectivity check
- [ ] Structured logging (pino) with request-id correlation, wired globally
- [ ] CI pipeline green: typecheck + lint + at least one passing test

**Exit criteria:** real WhatsApp message from a phone → correctly logged in `messages` with correct fields. A tampered/replayed request is provably rejected (test this deliberately). Same behavior confirmed on staging against the staging Twilio sender.

**Prompt for Claude Code — Phase 1:**
```
Read CLAUDE.md and docs/BUILD_SCRIPT.md Phase 1 section before starting. Confirm Phase 0
is merged to main and CI is green there before branching.

Build Phase 1: Foundation. No business/conversation logic yet — this phase proves the
pipe works and is secure before anything else is built on top of it.

1. src/config/env.ts — load and validate all required env vars (per .env.example), fail
   fast and loudly on boot if anything required is missing or malformed.
2. Set up Prisma with the full schema from docs/DATABASE_SCHEMA.md, generate the first
   migration, apply it to the dev database.
3. src/webhooks/twilio.validate.ts — Twilio signature validation middleware using the
   official Twilio SDK helper. This is the highest-priority security control in the
   system — write a real integration test that sends a genuinely-signed request and
   confirms it passes, AND a tampered request and confirms it's rejected with 403.
4. src/webhooks/twilio.controller.ts — POST /webhooks/twilio/inbound: validate signature,
   check MessageSid against the messages table for duplicates (idempotent), log and save
   the inbound message, respond 200 OK. No FSM/business logic yet.
5. POST /webhooks/twilio/status — same idempotency discipline, updates messages.status
   from Twilio's delivery/read callbacks.
6. GET /health — checks DB and Redis connectivity, returns 200/503 accordingly.
7. Wire Pino structured logging globally with a request-id correlated through each request.
8. Write tests for: env validation failing correctly on missing vars, signature validation
   (valid + tampered), webhook idempotency (same MessageSid processed twice = no duplicate
   row), /health reporting correctly when DB/Redis are up vs down.

Branch: phase-1-foundation. Commit in logical scoped chunks. Open a PR with a description
covering what was built and how each exit criterion in BUILD_SCRIPT.md Phase 1 was verified.
Do not merge until CI is green. Do not proceed to Phase 2 until this is merged.
```

---

## Phase 2 — Conversation engine core

- [x] Session model + repository (`sessions` table), load-or-create by phone number
- [x] FSM driver (`conversation/engine.ts`) — orchestration only, no business logic inline
- [x] Implement `WELCOME` → `COVERAGE_CHECK` end-to-end first (smallest full-loop slice)
- [x] Messaging Service wired — real outbound sends, retry/backoff on transient failures, no retry on permanent failures
- [x] Manual test: message sandbox, get welcome message, reply with a zone, confirm both in-zone and out-of-zone branches work and are logged

**Exit criteria:** two-turn conversation works end-to-end on sandbox, state persists correctly between turns, malformed/unexpected reply falls through to fallback response without crashing.

**Prompt for Claude Code — Phase 2:**
```
Read CLAUDE.md and docs/BUILD_SCRIPT.md Phase 2 section. Confirm Phase 1 is merged and
CI is green before branching.

Build Phase 2: Conversation engine core — the smallest possible full loop, not the whole flow.

1. Session repository backed by the sessions table (load-or-create by phone_number).
2. src/conversation/engine.ts — pure orchestration: load session -> dispatch to the
   handler for the current state -> persist new state -> execute side effects -> send
   outbound messages. No business logic inside this file.
3. Implement exactly two states end-to-end: WELCOME and COVERAGE_CHECK, using the FSM
   design in docs/TRD.md §2 and the exact message copy from docs/PRD.md §10 (Welcome,
   Coverage confirmed, Out of coverage). Coverage zones per docs/PRD.md §7, keyword-matched.
4. src/messaging/send.service.ts — real outbound sends via the Twilio REST API, retry with
   backoff on transient failures (429/5xx/timeout), no retry on permanent failures
   (invalid number, opted out). Every send logged to the messages table.
5. Do not implement any state beyond COVERAGE_CHECK yet.
6. Write unit tests for the WELCOME and COVERAGE_CHECK handlers as pure functions
   (context + input -> next state + messages), and an integration test that drives a
   real two-turn conversation through the webhook end to end.
7. Manually verify against the sandbox: send a message, receive the welcome text exactly
   as specified in PRD.md, reply with an in-zone area, confirm the bundle menu response;
   repeat with an out-of-zone area and confirm the waitlist response.

Branch: phase-2-conversation-engine-core. Open a PR with before/after conversation
transcripts from your manual sandbox test in the description. Do not merge until CI is
green. Do not proceed to Phase 3 until this is merged.
```

---

## Phase 3 — Full conversation flow

- [x] Remaining FSM states: `SERVICE_SELECTION` → `ADDRESS_COLLECTION` → `PICKUP_TIME` → `PAYMENT_METHOD` → `QUOTE_PENDING` → `AWAITING_PAYMENT` → `FEEDBACK_PENDING`
- [x] Pricing Service — bundle lookup, fee calculation, minimum order rule (`PRD.md` §6). Unit tested in isolation before wiring into the FSM
- [x] Order Service — creation on YES-confirmation, status transitions enforced via `order.statemachine.ts` (`TRD.md` §9) — illegal transitions rejected in code
- [x] Message copy wired exactly from `PRD.md` §10 — no paraphrasing
- [x] Fallback/error handling: unmatched input, 3-strikes escalation, unexpected media, no-active-session default

**Exit criteria:** full order placed end-to-end via WhatsApp on staging, "hi" through to an `orders` row at `awaiting_payment` (or ready for COD dispatch), every message matching `PRD.md` copy exactly.

**Prompt for Claude Code — Phase 3:**
```
Read CLAUDE.md and docs/BUILD_SCRIPT.md Phase 3 section. Confirm Phase 2 is merged and
CI is green before branching.

Build Phase 3: the complete customer conversation flow.

1. Implement the remaining FSM states in order: SERVICE_SELECTION, ADDRESS_COLLECTION,
   PICKUP_TIME, PAYMENT_METHOD, QUOTE_PENDING, AWAITING_PAYMENT, FEEDBACK_PENDING,
   per the state -> flow mapping in docs/TRD.md §3.
2. src/domain/pricing/pricing.service.ts — bundle lookup (docs/PRD.md §6.1), logistics
   fee and free-logistics threshold, minimum order rule. Bundle-only for this phase
   (per-item pricing is explicitly Phase 2 of the product, out of scope here). Write
   unit tests for this in isolation BEFORE wiring it into the FSM -- cover each bundle,
   the free-logistics threshold boundary, and the small-basket-surcharge boundary.
3. src/domain/orders/order.statemachine.ts — implement the legal-transition table from
   docs/TRD.md §9 exactly. Any transition not in that table must be rejected with a
   clear error and logged, never silently allowed. This is the ONLY code path allowed
   to write orders.status.
4. src/domain/orders/order.service.ts — order creation on YES-confirmation (from
   QUOTE_PENDING), routing to AWAITING_PAYMENT for bank transfer or directly toward
   dispatch-ready for COD, per docs/PRD.md §4 flow.
5. src/conversation/messages.ts — every message string from docs/PRD.md §10, copied
   exactly, no paraphrasing. Keep this file separate from the state handler logic files.
6. Fallback handling per docs/PRD.md and the error-handling patterns already established
   in Phase 1/2: unmatched input re-prompts with the current stage's message; 3 consecutive
   unmatched inputs escalates with a MENU option and flags the session for COO visibility;
   unexpected media outside AWAITING_PAYMENT gets a polite "text only for now" reply plus
   a repeat of the current prompt; no active session defaults safely to WELCOME.
7. Tests: unit tests per new state handler, unit tests for pricing edge cases, unit tests
   for the state machine's legal/illegal transitions, and one full integration test that
   drives an entire order from "hi" to an order row at awaiting_payment.
8. Manually run one full order on staging via WhatsApp and confirm every message matches
   PRD.md §10 verbatim.

Branch: phase-3-full-conversation-flow. Open a PR including the full manual conversation
transcript from your staging test in the description. Do not merge until CI is green.
Do not proceed to Phase 4 until this is merged.
```

---

## Phase 4 — Woshmen, partners, keyword protocol

- [x] Sender-type routing at top of webhook handler: known Woshman/partner → keyword parser; else → customer FSM
- [x] Keyword parser: `COLLECTED`, `LAUNDRY`, `READY`, `DELIVERING`, `DELIVERED <count>pcs`, `ISSUE <note>` (`TRD.md` §4)
- [x] Each keyword validated against order's current status before applying — reject with clear message on illegal action, don't silently corrupt state
- [x] Notification Service wired to every status transition — single fan-out point, nothing else sends WhatsApp messages directly

**Exit criteria:** simulated full order lifecycle via keyword messages from a test Woshman number on staging — customer receives every correct notification in order, no duplicates, no out-of-order messages.

**Prompt for Claude Code — Phase 4:**
```
Read CLAUDE.md and docs/BUILD_SCRIPT.md Phase 4 section. Confirm Phase 3 is merged and
CI is green before branching.

Build Phase 4: Woshman and partner laundry keyword protocol.

1. At the very top of the inbound webhook handler, add sender-type routing: look up the
   From number against the woshmen and partners tables. If matched, route to the keyword
   parser instead of the customer conversation FSM. Otherwise, proceed to the FSM as before.
2. src/messaging/keyword.parser.ts — parse: COLLECTED <order_id>, LAUNDRY <order_id>,
   READY <order_id> (partner only), DELIVERING <order_id>, DELIVERED <order_id> <n>pcs,
   ISSUE <order_id> <note>. Exact mapping to order status changes is in docs/TRD.md §4.
3. Every keyword action must call the SAME order.statemachine.ts transition function from
   Phase 3 -- do not add a second path that mutates orders.status. An illegal transition
   attempted via keyword (e.g. DELIVERED before PICKED_UP) must be rejected with a clear
   WhatsApp reply to the sender explaining the problem, not silently ignored or force-applied.
4. Unknown order ID or malformed keyword -> clear reply to the sender asking them to
   check and resend. Never a silent drop.
5. src/domain/notifications/notification.service.ts -- this becomes the single fan-out
   point for every outbound "event" from here on. Wire it so every status transition
   (however triggered) results in the correct notification per the matrix in docs/PRD.md
   §12. This service is the only thing that should be deciding "who gets told what" --
   both this keyword flow and any future admin-triggered flow call into it.
6. Tests: unit tests for the keyword parser (valid keywords, malformed keywords, unknown
   order IDs, illegal-transition attempts), and an integration test that plays a full
   sequence of keyword messages from a test Woshman number and asserts the customer
   receives the correct sequence of notifications with no duplicates or reordering.
7. Manually verify on staging using a real second WhatsApp number acting as the test
   Woshman, run a full order through COLLECTED -> LAUNDRY -> READY -> DELIVERING ->
   DELIVERED and confirm the customer number receives the correct messages in order.

Branch: phase-4-woshmen-partners-keyword-protocol. PR description includes the manual
staging test transcript (both the Woshman-side keyword messages and the customer-side
notifications received). Do not merge until CI is green. Do not proceed to Phase 5 until
this is merged.
```

---

## Phase 5 — Admin API + Retool

- [x] Admin auth: login endpoint, JWT issuance, bcrypt/argon2 password hashing
- [x] Seed exactly one `super_admin` account manually (no public signup endpoint exists)
- [x] `auth.middleware.ts` + `rbac.middleware.ts` wired from the first admin route, not bolted on later
- [x] Order endpoints: list/filter, detail, status transition, assignment (`TRD.md` §5.2)
- [x] User, Woshmen, Partner CRUD endpoints
- [x] `admin_actions` audit logging as middleware — automatic on every write route
- [ ] Retool app connected to Admin API as a REST resource; core COO screens built (orders, users, woshmen, partners); pages role-gated by `admins.role` — **not done by this PR**; requires a human with Retool account access, see PR description

**Exit criteria:** a COO-role admin can, entirely from Retool, verify a transfer, mark an order PAID, assign Woshman + partner, and watch correct WhatsApp notifications fire. A `viewer`-role login is provably (tested, not assumed) unable to perform any write action.

**Prompt for Claude Code — Phase 5:**
```
Read CLAUDE.md and docs/BUILD_SCRIPT.md Phase 5 section. Confirm Phase 4 is merged and
CI is green before branching.

Build Phase 5: Admin API for Retool.

1. POST /admin/auth/login -- verify credentials against the admins table (bcrypt or
   argon2id password hashing), issue a short-lived JWT (~8hr) containing admin id, role,
   issued-at, expiry. Provide a seed script (not a public endpoint) to create the first
   super_admin account.
2. src/admin-api/middleware/auth.middleware.ts -- verifies JWT signature and expiry on
   every admin route. src/admin-api/middleware/rbac.middleware.ts -- checks the route's
   required role against the token's role, per the min-role column in docs/TRD.md §5.2.
   Wire both on the FIRST admin route you write, not retrofitted after several routes exist.
3. src/admin-api/middleware/audit.middleware.ts -- automatically captures before/after
   state on every write route into admin_actions (admin id, action, entity type/id,
   before/after JSON, IP, timestamp). This must apply uniformly -- no write route is
   exempt, including ones that feel "small."
4. Implement every route in docs/TRD.md §5.2: orders (list/filter, detail, status
   transition, assign), users (list, flag), woshmen (list, update), partners (list,
   update), pricing (read; write is super_admin only), feedback (list), manual message
   send (routes through the Notification Service from Phase 4, never calls Twilio directly).
5. The order status transition endpoint MUST go through the same order.statemachine.ts
   function used by the conversation engine and keyword parser -- do not add a fourth
   path that can set orders.status directly.
6. Tests: auth (valid/invalid/expired JWT), RBAC (explicitly assert a viewer-role token
   is rejected on every write route, not just hidden in a UI), audit logging (confirm a
   write produces a correct admin_actions row), and the order status endpoint rejecting
   an illegal transition the same way the other two paths do.
7. Set up a Retool app connected to this API as a REST resource (staging first). Build
   the core COO screens: orders list/detail with status actions and assignment, users,
   woshmen, partners. Gate pages/actions by role where practical, understanding the real
   enforcement is server-side regardless.

Branch: phase-5-admin-api-retool. PR description includes a walkthrough (screenshots or
description) of the Retool flow: verify a transfer, mark PAID, assign Woshman+partner,
and confirmation that a viewer-role login was tested and correctly blocked from writes.
Do not merge until CI is green. Do not proceed to Phase 6 until this is merged.
```

---

## Phase 6 — Timeouts, sweeps, resilience

- [x] BullMQ setup, Redis-backed
- [x] 30-minute quote-abandon job, 60-minute payment-window-abandon job (`PRD.md` §8) — scheduled on entry to the relevant state, cancelled on normal progression
- [x] 24-hour auto-close job
- [x] Dead-letter handling for jobs that fail repeatedly — logged loudly, not retried forever, not silently dropped
- [x] Idempotency review pass across every mutation path — webhook retries, job retries, admin double-clicks all safe to repeat

**Exit criteria:** kill the process mid-conversation on staging, restart, confirm sessions resume correctly and no timeout job fires twice or gets lost. **Verified for real on staging** by the human tester (2026-07-23): a live WhatsApp conversation reached `PAYMENT_METHOD` ("How are you paying?") at 20:39, the Web Service was restarted via Render's Restart Service, and the reply sent at 20:53 (a 14-minute gap) correctly produced the exact right quote (Starter Bundle, ₦2,000 + ₦1,000 logistics = ₦3,000) rather than a reset to `WELCOME` — confirming the session resumed from Postgres correctly across a real process restart. Not independently observable by Claude Code (no access to Render or the tester's WhatsApp conversation); this records the tester's own account, same distinction as Phase 5's Retool walkthrough. The earlier local kill/restart proxy (see PR #17) additionally confirmed the scheduled job itself (not just the session) survives a restart without duplicating or being lost.

**Prompt for Claude Code — Phase 6:**
```
Read CLAUDE.md and docs/BUILD_SCRIPT.md Phase 6 section. Confirm Phase 5 is merged and
CI is green before branching.

Build Phase 6: timeouts, sweeps, and resilience.

1. src/jobs/queue.ts -- BullMQ setup against Redis.
2. src/jobs/sessionTimeout.job.ts -- the 30-minute quote-abandon timeout and the 60-minute
   payment-window timeout from docs/PRD.md §8, including the 45-minute payment reminder.
   Schedule each job when the session enters the relevant state; cancel it if the session
   progresses normally before it fires. On firing, transition the order/session per
   docs/PRD.md (ABANDONED status, timeout message from PRD.md §10) and notify COO where
   the notification matrix in PRD.md §12 calls for it.
3. src/jobs/autoClose.job.ts -- 24 hours after DELIVERED with no DISPUTED flag, auto-
   transition to CLOSED via order.statemachine.ts.
4. Dead-letter handling: any job that exhausts its retry attempts must be logged loudly
   (visible in monitoring) and NOT retried indefinitely and NOT silently dropped -- surface
   it somewhere COO/eng would see it (a dedicated log level or a flag visible via the
   Admin API is fine for MVP).
5. Do an idempotency review pass across the whole codebase so far: every webhook handler,
   every job handler, and every admin write endpoint should be safe to run twice with the
   same input and land in the same end state. Write tests specifically proving this for
   the timeout jobs and the webhook handlers (run the same job/request twice, assert no
   duplicate side effects).
6. Manually verify on staging: start an order, kill the backend process mid-conversation,
   restart it, confirm the session resumes from the correct state and the appropriate
   timeout job is still correctly scheduled (not duplicated, not lost).

Branch: phase-6-timeouts-sweeps-resilience. PR description includes the kill/restart test
results. Do not merge until CI is green. Do not proceed to Phase 7 until this is merged.
```

---

## Phase 7 — Security & production hardening

Go through `TRD.md` §7 (non-functional requirements) and `CLAUDE.md` non-negotiable rules line by line:

- [ ] Signature validation confirmed against production Twilio config (exact URL, protocol, path) — not just staging
- [ ] Rate limiting active: per-phone-number, global webhook, Admin API
- [ ] All Admin API inputs Zod-validated
- [ ] Money confirmed as integer kobo everywhere — grep for any float/NUMERIC currency usage and eliminate
- [ ] Secrets confirmed absent from git history
- [ ] Logs reviewed for PII leakage at `info` level
- [ ] Backups confirmed running + one test restore performed
- [ ] Error tracking wired and confirmed (deliberate test error captured)
- [ ] Alert thresholds configured per `CLAUDE.md` alerting philosophy — confirmed to *not* fire on expected/normal transient blips

**Exit criteria:** a stranger with production access could trust the guardrails without relying on the builder's memory of having been careful.

**Prompt for Claude Code — Phase 7:**
```
Read CLAUDE.md in full and docs/BUILD_SCRIPT.md Phase 7 section. Confirm Phase 6 is
merged and CI is green before branching.

Build Phase 7: security and production hardening pass. This is a dedicated audit-and-fix
phase across the whole codebase so far, not new features.

1. Rate limiting: add per-phone-number limiting on the inbound webhook path, a global
   rate limit on the webhook endpoints as a backstop, and per-admin/IP rate limiting on
   the Admin API. Confirm the Messaging Service respects Twilio/WhatsApp's outbound
   rate tiers (queue + throttle, don't fire-and-forget at full speed).
2. Confirm every Admin API route validates its input with a Zod schema -- add any that
   are missing.
3. Grep the entire codebase and schema for any currency field or calculation using
   float/NUMERIC instead of integer kobo. Fix any found.
4. Run a secrets sweep across git history (not just the current working tree) for
   anything that looks like a committed credential. Report findings.
5. Review every log statement at info level or above for PII (full message bodies, raw
   phone numbers in bulk, addresses) that shouldn't be there in a long-retention log --
   reduce to IDs/references where the full content isn't needed.
6. Confirm automated daily backups are configured on the production database and document
   how to perform a restore. If possible in this environment, actually perform one test
   restore and record the result.
7. Wire error tracking (Sentry or equivalent) if not already done, and confirm it
   captures a deliberately-thrown test exception end to end.
8. Set up alert rules per the alerting philosophy in CLAUDE.md: urgent/paging alerts ONLY
   for API fully down, DB unreachable, or payment/data-integrity issues. Everything else
   (individual send failures after retries, single slow jobs) should be visible in
   logs/Retool, not paged. Explicitly test that a single transient failure does NOT
   trigger a page.
9. Produce a short written summary mapping each item in this phase to what was found and
   fixed (or confirmed already correct).

Branch: phase-7-security-hardening. PR description is the audit summary from step 9.
Do not merge until CI is green. Do not proceed to Phase 8 until this is merged and the
summary has been reviewed by a human.
```

---

## Phase 8 — Launch readiness

- [ ] WhatsApp message templates approved (order confirmation, delivery notice, feedback nudge, stale-session nudge) — submitted back in Phase 0, confirm approval status now
- [ ] Full manual end-to-end run on staging: place a real order, run through every status via keyword messages, verify feedback flow, verify a deliberately-wrong keyword is rejected cleanly
- [ ] Production Twilio sender's webhook URLs pointed at production API
- [ ] `super_admin` account created directly in production DB (not migrated from staging)
- [ ] Pricing config seeded/confirmed correct for launch
- [ ] Monitoring dashboards reviewed by a second person before go-live
- [ ] **Supervised pilot (see 8a below) completed before opening to unsupervised customer traffic**

**Exit criteria:** first real customer order completes successfully end-to-end on production with no manual workaround required outside the defined COO steps (payment verification, assignment).

**Prompt for Claude Code — Phase 8:**
```
Read CLAUDE.md and docs/BUILD_SCRIPT.md Phase 8 section. Confirm Phase 7 is merged and
CI is green before branching. This phase is verification and go-live steps, not new
feature code -- treat it as a checklist to execute and document, not something to
architect further.

1. Confirm WhatsApp message template approval status for: order confirmation, delivery
   notice, feedback nudge, stale-session nudge. Report status of each.
2. Run one complete manual end-to-end order on staging: place a real order via WhatsApp,
   drive it through every status using keyword messages from a test Woshman/partner
   number, confirm the feedback flow fires and behaves correctly for each of the three
   score options, and deliberately send one malformed/illegal keyword message to confirm
   it's rejected cleanly with a clear reply rather than silently failing or corrupting state.
3. Prepare (but do not execute without explicit human confirmation) the production
   cutover steps: pointing the production Twilio sender's webhook URLs at the production
   API, seeding the production super_admin account directly (not migrated from staging),
   confirming pricing config is correct for launch.
4. Summarize monitoring/alerting status for a second-person review before go-live.
5. Stop here and report back rather than flipping any production DNS/webhook switch
   yourself -- that step should be a deliberate human action given it's the actual go-live
   moment, per CLAUDE.md's manual-production-promotion rule.

Branch: phase-8-launch-readiness. PR contains the full staging end-to-end test transcript
and the launch-readiness summary. Do not merge until CI is green and a human has approved.
```

### Phase 8a — Supervised pilot (do this before unsupervised launch)

Do not go straight from staging tests to open customer traffic. Run a small number of real orders on production with a human actively watching, before the system runs unattended.

- [ ] Pick 3–5 real orders from real customers (friends/family/early testers are fine, but the orders and payments should be genuinely real, not simulated) to run through production
- [ ] For each pilot order, a human watches the WhatsApp conversation live, end to end — not just checking the outcome afterward
- [ ] COO performs payment verification and assignment as normal, but with an engineer available in real time in case something needs a manual fix
- [ ] At least one pilot order deliberately exercises an off-path branch (e.g. a timeout, or a genuinely wrong keyword from the test Woshman) to confirm the fallback behavior works with real users watching, not just in a staging test
- [ ] After the pilot, review: did every message match `PRD.md` §10 exactly? Did every status transition and notification fire correctly? Did anything require a manual workaround that shouldn't have been necessary?
- [ ] Only after the pilot orders complete cleanly (or any issues found are fixed and re-verified) does the system move to open, unsupervised customer traffic

This is not a formality — it's the actual point where "the code passed review" gets checked against "real people using it in real time." Skipping it to launch faster defeats the purpose of everything in Phases 0–7.

---

## Phase 9+ — Post-MVP (only after MVP is live and stable)

Do not start these speculatively — they're listed for visibility, not as a queue to work through automatically. When one is actually needed, write a fresh prompt referencing the relevant PRD/TRD section rather than reusing an MVP-phase prompt verbatim.

- [ ] Stale-session nudge job using approved templates
- [ ] Feedback flow fully surfaced in Retool with resolved-tracking
- [ ] Admin audit log surfaced in Retool for review
- [ ] Pricing config made editable via Retool (moves off static config into `pricing_config` table)
- [ ] Per-item pricing flow (`PRD.md` §6.2, Phase 2)
- [ ] Google Maps zone verification — only if keyword-matching starts missing too often in practice
- [ ] Multi-instance backend behind a load balancer — only if a single instance is demonstrably maxed
- [ ] Read replica for Retool reporting — only if Retool queries start impacting write-path latency
- [ ] Admin write path for `partners.outstandingBalanceKobo` and `partners.lastRating` — `PATCH /admin/partners/:id` (Phase 5) doesn't accept either field; there's currently no way to record a partner's balance owed or rating through the Admin API at all, Retool included

Before starting anything in this section, confirm it's actually needed against real usage data, not just "nice to have."
