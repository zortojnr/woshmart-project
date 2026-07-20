# Woshmart — Build Log

Updated on every phase merge, not before. This is the single source of truth for "what's actually done" — `docs/BUILD_SCRIPT.md` checkboxes track task-level progress *within* a phase; this table tracks phase-level completion and links the evidence.

**Rule:** a phase is only marked Complete here once its PR has merged with CI green and its exit criteria (per `BUILD_SCRIPT.md`) have been met and verified — not when the code is written, not when CI is pending.

## Phase tracker

| Phase | Status | Branch | PR | CI | Started | Completed | Notes |
|---|---|---|---|---|---|---|---|
| 0 — Pre-work & scaffolding | Not started | — | — | — | — | — | |
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

## Post-MVP (Phase 9+) log

Track ad hoc — these aren't sequential/gated the way Phases 0–8 are, so log each as it's picked up rather than pre-listing rows.

| Item | Status | PR | Notes |
|---|---|---|---|
| — | — | — | — |
