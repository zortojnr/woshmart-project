# Woshmart — Phase 8: Staging End-to-End Walkthrough

Companion to Phase 8 of `BUILD_SCRIPT.md` item 2. This has to be executed by a human — Claude Code has no WhatsApp, Twilio, or Retool access to actually send/receive real messages. Follow this step by step and fill in the transcript sections as you go; the completed version of this file (or a copy of it) is what goes in the Phase 8 PR.

Real staging phone numbers required: one acting as the customer, one acting as the test Woshman, one acting as the test partner. Use `scripts/seed-test-woshman-partner.ts` against staging if the test Woshman/partner records don't already exist there.

## Before you start: one real gap this walkthrough works around, not fixes

There is **no automated trigger anywhere in the code** that moves an order from `assigned` to `pickup_scheduled` — checked directly against every controller/service/job in the repo, not assumed. `TRD.md` §9's legal-transition table requires an order to be at `pickup_scheduled` before `picked_up` (the `COLLECTED` keyword's target), and `PRD.md`'s notification matrix lists `PICKUP_SCHEDULED` as a COO-triggered step — meaning this is an intentional manual action, not a bug, but it has no purpose-built Retool button. **Part C below is that manual step.** Skip it and the Woshman's `COLLECTED` message will come back as an illegal-transition rejection, which would look like a bug but isn't one — this is worth reporting as a real UX gap in the launch-readiness summary regardless (Phase 8 is verification, not a fix, so it's flagged, not built here).

---

## Part A — Place a real order (customer side, via WhatsApp)

Message the staging WhatsApp number from the customer test phone.

| # | You send | Expected reply | ✅/❌ + notes |
|---|---|---|---|
| 1 | Any message (e.g. "Hi") | Welcome message (`PRD.md` §10 exact copy) | |
| 2 | `Maitumbi` (an in-coverage zone) | Bundle menu (Starter/Weekly/Family/Household/Per-item) | |
| 3 | Reply matching **Starter Bundle** (₦2,000) | Address prompt | |
| 4 | A real/plausible street address | Pickup window menu | |
| 5 | `1` (today, 7AM–12PM) | Payment method prompt (transfer / COD) | |
| 6 | `1` for **transfer** (test the harder path — COD skips the payment wait entirely) | Quote summary + YES/NO prompt | |
| 7 | `YES` | Bank transfer instructions, with the real order number (`WM-NNN`) | |

**Record the order number here:** `WM-___`

This is the one and only point the order row gets created (`createOrderFromQuote`, called exactly once, on `YES`) — confirm in Retool's Orders screen that `WM-___` now exists at status `awaiting_payment`.

## Part B — COO actions (Retool)

1. In Retool, open order `WM-___`. Confirm status is `awaiting_payment`, `payment_method: transfer`.
2. **Mark paid**: use the order-status action, set status to `paid`. (Confirms the real transfer would be manually verified first in a real launch — nothing to verify here, this is staging.)
3. **Assign**: pick the seeded test Woshman and test partner, assign. Confirm status moves to `assigned` automatically as part of the assign action (not a separate step).
4. **On the test Woshman's phone:** confirm a dispatch brief WhatsApp message arrived.
5. **On the test partner's phone:** confirm a job brief WhatsApp message arrived.

**Record:** did both briefs arrive? Any delay? _____

## Part C — the manual pickup_scheduled step (see the gap noted above)

In Retool, use the generic order-status field to set `WM-___` to `pickup_scheduled` directly. There's no dedicated button for this — it's the same status-override control used for any manual correction.

## Part D — keyword-driven status progression (Woshman/partner side)

Send these from the **test Woshman's** phone unless noted otherwise. Exact syntax matters — the parser is strict.

| # | Sender | You send | Expected reply / effect | ✅/❌ + notes |
|---|---|---|---|---|
| 1 | Woshman | `COLLECTED WM-___` | No reply to the Woshman on success (silent unless it's a no-op/error) — confirm in Retool that status is now `picked_up`, and the **customer** got a status-update WhatsApp message | |
| 2 | Woshman | `LAUNDRY WM-___` | Status → `at_laundry`, customer notified | |
| 3 | **Partner** | `READY WM-___` | Status → `ready_for_delivery`, customer notified. (`READY` is partner-only — confirm this is genuinely rejected from the Woshman's number, see Part F) | |
| 4 | Woshman | `DELIVERING WM-___` | Status → `out_for_delivery`, customer notified | |
| 5 | Woshman | `DELIVERED WM-___ 5pcs` | Status → `delivered`, customer notified, **and** the customer's session moves to `FEEDBACK_PENDING` — the feedback prompt should arrive on the customer's phone right after | |

## Part E — feedback flow (customer side)

1. On the customer's phone, confirm the feedback prompt arrived (`PRD.md` §10 exact copy: "Quick one — how did we do? 1. All good 👍 / 2. Had a small issue / 3. Something went wrong — please call me").
2. Reply `1`. Confirm the score-1 response arrives ("Glad to hear it!..."), and in Retool/DB that a `feedback` row exists for `WM-___` with `score: 1`.

**Scope note on the other two score values:** all three score branches (1/2/3, including the score-3 urgent-COO-flag logging) are already covered by `tests/conversation/states/feedback.test.ts` in isolation — what this manual pass actually needs to confirm live is the *trigger* (does `DELIVERED` really land the customer in `FEEDBACK_PENDING` with the prompt sent, in a real conversation, not a test harness) and that at least one score round-trips correctly end to end. If you want full manual coverage of all three replies too, that requires driving two more complete orders through to `DELIVERED` (a session can only be scored once — it moves to `IDLE` after the first reply). Your call on whether that's worth the extra time for this pass; flagging the tradeoff rather than deciding it silently.

## Part F — deliberately wrong keyword messages (confirm clean rejection, not silent failure or corrupted state)

Send each of these and confirm the exact reply — none of these should silently do nothing or leave the order in a weird state.

| # | Sender | You send | Expected reply |
|---|---|---|---|
| 1 | Woshman | `COLLECTD WM-___` (typo) | Malformed-command message listing valid formats |
| 2 | Woshman | `READY WM-___` (Woshman sending a partner-only keyword) | "can't be sent from this number" rejection |
| 3 | Woshman | `COLLECTED WM-999` (a real-looking but nonexistent order number) | "We don't have an order WM-999" |
| 4 | Woshman | `COLLECTED WM-___` again, after the order is already past `picked_up` | Either the "already at status" no-op reply or the illegal-transition rejection, depending on current status — confirm it's one of those two, not a crash or silence |

**Record each actual reply text here, verbatim, for the PR transcript:**
1. _____
2. _____
3. _____
4. _____

---

## Completed transcript

Fill in as executed — dates/times, exact message text both directions, and the ✅/❌ column above. This whole file (with the tables filled in) is the evidence that goes in the Phase 8 PR per `BUILD_SCRIPT.md`'s requirement.
