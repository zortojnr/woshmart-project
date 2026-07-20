# Woshmart — Build Log

Updated on every phase merge, not before. This is the single source of truth for "what's actually done" — `docs/BUILD_SCRIPT.md` checkboxes track task-level progress *within* a phase; this table tracks phase-level completion and links the evidence.

**Rule:** a phase is only marked Complete here once its PR has merged with CI green and its exit criteria (per `BUILD_SCRIPT.md`) have been met and verified — not when the code is written, not when CI is pending.

## Phase tracker

| Phase | Status | Branch | PR | CI | Started | Completed | Notes |
|---|---|---|---|---|---|---|---|
| 0 — Pre-work & scaffolding | Complete | `phase-0-scaffolding` | [#1](https://github.com/zortojnr/woshmart-project/pull/1) | green | 2026-07-20 | 2026-07-20 | |
| 1 — Foundation | Not started | — | — | — | — | — | |
| 2 — Conversation engine core | Not started | — | — | — | — | — | |
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

## Post-MVP (Phase 9+) log

Track ad hoc — these aren't sequential/gated the way Phases 0–8 are, so log each as it's picked up rather than pre-listing rows.

| Item | Status | PR | Notes |
|---|---|---|---|
| — | — | — | — |
