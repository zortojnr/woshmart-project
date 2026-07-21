# Woshmart — Build Log

Updated on every phase merge, not before. This is the single source of truth for "what's actually done" — `docs/BUILD_SCRIPT.md` checkboxes track task-level progress *within* a phase; this table tracks phase-level completion and links the evidence.

**Rule:** a phase is only marked Complete here once its PR has merged with CI green and its exit criteria (per `BUILD_SCRIPT.md`) have been met and verified — not when the code is written, not when CI is pending.

## Phase tracker

| Phase | Status | Branch | PR | CI | Started | Completed | Notes |
|---|---|---|---|---|---|---|---|
| 0 — Pre-work & scaffolding | Complete | `phase-0-scaffolding` | [#1](https://github.com/zortojnr/woshmart-project/pull/1) | green | 2026-07-20 | 2026-07-20 | |
| 1 — Foundation | Complete | `phase-1-foundation` | [#2](https://github.com/zortojnr/woshmart-project/pull/2) | green | 2026-07-21 | 2026-07-21 | |
| 2 — Conversation engine core | Complete | `phase-2-conversation-engine-core` | [#4](https://github.com/zortojnr/woshmart-project/pull/4) | green | 2026-07-21 | 2026-07-21 | |
| 3 — Full conversation flow | Not started | — | — | — | — | — | |
| 4 — Woshmen, partners, keyword protocol | Not started | — | — | — | — | — | |
| 5 — Admin API + Retool | Not started | — | — | — | — | — | |
| 6 — Timeouts, sweeps, resilience | Not started | — | — | — | — | — | |
| 7 — Security & production hardening | Not started | — | — | — | — | — | |
| 8 — Launch readiness | Not started | — | — | — | — | — | |
| 8a — Supervised pilot | Not started | — | — | — | — | — | Not a code phase — log pilot order outcomes here, not a PR |

**Status values:** `Not started` / `In progress` / `Blocked` / `In review` / `Complete`

If a phase is `Blocked`, add a line in Notes explaining what it's blocked on (e.g. "Blocked — WhatsApp Business Profile still in Meta review") — don't leave a blocked phase silently sitting as "In progress."

## Per-phase completion record

Copy this template into a new section below for each phase as it completes — this is the detail behind the summary table above.

```
### Phase N — <name>

- **Merged:** <date>, PR #<number> (<link>)
- **CI:** green on merge — <link to the passing run>
- **Exit criteria met:** <restate the exit criteria from BUILD_SCRIPT.md and confirm each was verified, with evidence — e.g. "tampered webhook request confirmed rejected with 403, see test <name>">
- **What was built:** <short summary>
- **What was tested:** <unit/integration/manual, and what manual verification was actually run>
- **Deferred / explicitly not done:** <anything intentionally left out, and why — should match anything flagged in the PR description>
- **Issues found during the phase:** <anything that came up — a PRD ambiguity that had to be resolved, a decision that deviated from the docs and why>
```

## Per-phase completion record

### Phase 0 — Pre-work & scaffolding

- **Merged:** 2026-07-20, PR #1 (https://github.com/zortojnr/woshmart-project/pull/1)
- **CI:** green on merge — run 29745154859
- **Exit criteria met:** Phase 0's code-facing exit criterion is repo scaffolding existing, matching `ARCHITECTURE.md` §4, with CI passing typecheck/lint/test — confirmed. (The ops-facing exit criterion — a WhatsApp message to the sandbox number producing a raw payload in a local log — depends on Phase 1's webhook handler and the human/ops setup in `docs/SETUP_GUIDE.md`; not applicable to this code-only PR.)
- **What was built:** Node.js + TypeScript (strict) project per `TRD.md` §1's stack; full `ARCHITECTURE.md` §4 folder structure with real stub files; `package.json` scripts (dev/build/test/lint/format/typecheck); ESLint + Prettier; GitHub Actions CI (typecheck + lint + test); `.env.example` per `SETUP_GUIDE.md` §4; `.gitignore`.
- **What was tested:** `npm run typecheck`, `npm run build`, `npm run lint`, `npm test` all run clean locally and in CI (placeholder smoke test only — real tests start Phase 1).
- **Deferred / explicitly not done:** all business/conversation logic, env validation logic, Prisma migration, webhook handling — everything Phase 1+.
- **Issues found during the phase:** `ARCHITECTURE.md` §4 shows the Prisma schema nested at `src/db/prisma/schema.prisma`; the real, populated schema (matching `DATABASE_SCHEMA.md`) already lived at the conventional root `prisma/schema.prisma`. Kept the root file as source of truth rather than duplicating it — flagged in the PR. Also: the repo had no commits on `main` at all before this phase, so the first scaffolding commit was pushed directly to `main` to give the PR a base.

### Phase 1 — Foundation

- **Merged:** 2026-07-21, PR #2 (https://github.com/zortojnr/woshmart-project/pull/2)
- **CI:** green on merge — run 29812067871
- **Exit criteria met:** a genuinely-signed webhook request (computed with the real Twilio algorithm, not a mock) is accepted; a tampered request and a garbage/missing signature are provably rejected with 403 (`tests/webhooks/twilio.signature.test.ts`, both cases). A replayed `MessageSid` produces exactly one `messages` row on both the inbound and status-callback paths (`tests/webhooks/idempotency.test.ts`). `/health` correctly reports DB/Redis up/down. Env validation fails fast and loudly on missing/malformed required vars. CI green with typecheck + lint + 18 tests, against ephemeral Postgres/Redis service containers.
- **What was built:** `src/config/env.ts` (Zod-validated env loading, fails fast on boot); Prisma schema + first migration applied to the dev DB, plus a second migration adding Postgres `CHECK` constraints for enum-like columns; `src/webhooks/twilio.validate.ts` (signature validation via the official `twilio.validateRequest` helper, reconstructing the public URL from forwarded proto/host headers); `src/webhooks/twilio.controller.ts` (`POST /webhooks/twilio/inbound` and `/status`, both idempotent by `MessageSid`); `GET /health`; Pino structured logging with request-id correlation.
- **What was tested:** automated — signature validation (valid/tampered/garbage/missing), idempotency (inbound + status), env validation (valid boot, missing var, malformed `DATABASE_URL`, short `JWT_SIGNING_SECRET`, partial object-storage config), health checks (DB down, Redis down). Manual — signed/tampered/replayed requests run against a live dev server with the real dev Twilio Auth Token before automating them; `/health` manually confirmed against real dev Postgres/Redis.
- **Deferred / explicitly not done:** all business/conversation logic, FSM, keyword parsing — everything Phase 2+.
- **Issues found during the phase:** `SENTRY_DSN` is listed in `SETUP_GUIDE.md` §4 as required before Phase 1, but Sentry isn't wired into any code until Phase 7 — made optional in `env.ts` rather than blocking boot on an unused external service, flagged in the PR for Phase 7 to revisit. `DATABASE_SCHEMA.md`/`TRD.md` §6's per-column `CHECK` constraints had no first-class Prisma representation in this version — added as a second raw-SQL migration instead of editing the already-applied first one.

### Phase 2 — Conversation engine core

- **Merged:** 2026-07-21, PR #4 (https://github.com/zortojnr/woshmart-project/pull/4)
- **CI:** green on merge — run 29833991837
- **Exit criteria met:** two-turn conversation works end-to-end on the real sandbox — verified live against a real phone and the real Twilio WhatsApp sandbox (via a Cloudflare quick tunnel to a local dev server), with every turn cross-checked directly against the `messages`/`sessions` tables (not just the phone screen): welcome copy exact, out-of-coverage/waitlist copy exact (Kpakungu), in-zone bundle-menu copy exact (Maitumbi), session state persisting correctly turn to turn (`WELCOME` → `COVERAGE_CHECK` → `SERVICE_SELECTION`). Malformed/unrecognized area input falls through to the out-of-coverage response without crashing (unit-tested and confirmed by design, not separately re-run live). Also automated end-to-end in `tests/webhooks/conversation.e2e.test.ts` against the real webhook/signature/DB/engine path.
- **What was built:** `src/conversation/types.ts` (FSM types per `TRD.md` §2); `src/conversation/session.repository.ts` (load-or-create by `phone_number`, atomic upsert); `src/conversation/engine.ts` (pure orchestration, no business logic inline); `WELCOME`/`COVERAGE_CHECK` state handlers as pure functions; `src/domain/zones/zone.service.ts` (coverage keyword-matching per `PRD.md` §7); `src/messaging/twilio.client.ts` + `send.service.ts` (the only code path that calls Twilio's send API, retry/backoff on transient failures, no retry on permanent ones, every send logged to `messages`); webhook controller now dispatches non-duplicate inbound messages to the engine.
- **What was tested:** unit tests for both state handlers as pure `(context, input) → result` functions, covering in-zone/waitlist/not-yet-available/unrecognized input and both branches of the waitlist YES/NO follow-up; `send.service` unit tests (success, transient retry-then-succeed, permanent no-retry, retry-budget exhaustion) against a mocked Twilio client with fake timers; a real end-to-end webhook integration test; a live manual sandbox test (see PR #4 description for the full transcript with real Twilio SIDs).
- **Deferred / explicitly not done:** everything past `COVERAGE_CHECK` (Phase 3); Woshman/partner keyword routing (Phase 4 — every inbound message currently goes to the customer FSM); the `MARK_WAITLISTED` side effect is logged by the engine but not yet wired to a real domain service (no waitlist/user-flagging service exists until a later phase touches `User` data).
- **Issues found during the phase:** `PRD.md` §10 has no specified copy for the bot's reply after a customer answers YES/NO to the waitlist offer (`TRD.md` §3 only specifies the state transition, not the message) — flagged rather than inventing new copy; a YES currently ends the session silently after logging the side effect. Worth a copy decision before Phase 8a's pilot.

## Post-MVP (Phase 9+) log

Track ad hoc — these aren't sequential/gated the way Phases 0–8 are, so log each as it's picked up rather than pre-listing rows.

| Item | Status | PR | Notes |
|---|---|---|---|
| — | — | — | — |
