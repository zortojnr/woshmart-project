# Woshmart — Phase 8: Staging End-to-End Walkthrough

Companion to Phase 8 of `BUILD_SCRIPT.md` item 2. This has to be executed by a human — Claude Code has no WhatsApp, Twilio, or Retool access to actually send/receive real messages. Follow this step by step and fill in the transcript sections as you go; the completed version of this file (or a copy of it) is what goes in the Phase 8 PR.

Real staging phone numbers required: one acting as the customer, one acting as the test Woshman, one acting as the test partner. Use `scripts/seed-test-woshman-partner.ts` against staging if the test Woshman/partner records don't already exist there.

## Before you start: a confirmed bug this walkthrough works around, not fixes

There is **no automated trigger anywhere in the code** that moves an order from `assigned` to `pickup_scheduled` — checked directly against every controller/service/job in the repo, not assumed. Initially this looked like it could be an intentional manual COO step, since `PRD.md`'s status table lists `PICKUP_SCHEDULED | COO | Pickup time confirmed`. **Checked further and confirmed this is a real missing-automation bug, not an intentional design:** `USER_JOURNEY.md`'s own sequence diagram — the actual intended flow, not just a status table — goes straight from `COO->>Bot: Assign Woshman + Partner` to the Woshman's `"COLLECTED <id>"` message, with no separate confirmation step in between, and explicitly describes this stretch as "Automatic status updates as Woshman/partner progress the order." The customer already chose their pickup window during the original conversation, before the order even existed — there's nothing left to confirm with them at assignment time. This is tracked as a bug to fix in its own follow-up PR (not this one — Phase 8 is verification/docs only), not something to leave as permanent manual process.

**Part C below is the workaround** until that fix lands. Skip it and the Woshman's `COLLECTED` message will come back as an illegal-transition rejection.

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

Executed live against staging on 2026-07-24/25, order `WM-003`. Recorded by the human tester (Claude Code has no WhatsApp/Twilio/Retool access, per the note at the top of this file) and cross-checked against the database directly (`order_status_history`, `messages`) rather than taken on WhatsApp-delivery-timing alone — see the operational note at the bottom.

**Part A — placing the order:** completed in full. Real conversation (welcome → area → bundle → address → pickup time → payment method → quote → `YES`) produced `WM-003` at `awaiting_payment`, exactly as specified. ✅

**Part B — COO actions:**
1. Opened `WM-003` in Retool, confirmed `awaiting_payment` / `payment_method: transfer`. ✅
2. **Mark PAID hit a real bug, since fixed:** the Retool button was configured to send `status: "PAID"` (uppercase) in its PATCH body. The Admin API's `statusUpdateSchema` (`orders.controller.ts`) validates `status` against the `OrderStatus` enum case-sensitively, by design (`z.enum`, not a case-insensitive match) — so it correctly rejected the malformed request rather than silently coercing it. This is a Retool-config bug, not a backend bug: the backend behaved exactly as CLAUDE.md rule 4 requires (illegal/malformed transitions rejected, not silently allowed). Fixed by correcting the Retool button's payload to lowercase `"paid"`; confirmed working after the fix. ✅ (backend correct throughout; Retool config was the actual defect)
3. Assigned test Woshman + test partner via Retool. Status moved to `assigned` automatically as part of the assign action, no separate step. ✅
4. Woshman's phone received the dispatch brief in the new corrected multi-line format (`docs/BUILD_SCRIPT.md`/`messages.ts` fix from PR #24) — real time-window text, not the previously-raw stored number. ✅
5. Partner's phone received the job brief. ✅

**Part C — manual `pickup_scheduled` step:** performed via the Admin API's `PATCH /admin/orders/:id/status` (same endpoint Retool's status-override control calls). Confirmed applied — verified directly via `order_status_history`, which shows the `pickup_scheduled` row preceding the `picked_up` transition below. ✅

**Part D — keyword-driven progression (test Woshman's phone unless noted):**
1. `COLLECTED WM-003` → transitioned to `picked_up`. Confirmed independently via `order_status_history`: `pickup_scheduled → picked_up` at `2026-07-25T14:42:52Z`, `changed_by: woshman`, correct note. ✅
   - Repeat `COLLECTED WM-003` sent later → correctly returned the idempotency no-op reply ("...already marked as picked_up, no changes made") instead of erroring, duplicating the history row, or re-firing the customer notification (CLAUDE.md rule 6). ✅ — this also satisfies Part F, item 4 below.
2. `LAUNDRY WM-003` → transitioned to `at_laundry`. Reply showed the corrected copy (comma instead of em dash, from PR #24). ✅
3. `READY WM-003` sent from the **Woshman's** number (not the partner's) — correctly **rejected** ("READY can't be sent from this number..."), confirmed against `TRD.md` §4 ("Sent by partner, not Woshman") and the `KEYWORD_RULES` sender check in `keywordProtocol.service.ts`. ✅ as a sender-authorization test — but this does **not** cover the actual partner-side success path (a real `READY` from a genuine partner number transitioning the order and alerting the Woshman). **Not tested** — no second number was available to register as the test partner. Order was instead advanced to `ready_for_delivery` via a direct Admin API status override to unblock the rest of the walkthrough (see below). This gap is carried forward, not silently treated as covered.
   - Extra verification found along the way, not in the original table: `DELIVERING WM-003` was sent (Woshman) *before* `ready_for_delivery` was reached — correctly **rejected** ("current status is at_laundry, check the order and try again"), confirming the state machine blocks skipping a step (CLAUDE.md rule 4) live, not just in unit tests. ✅
4. Order manually advanced to `ready_for_delivery` via `PATCH /admin/orders/:id/status`, in place of the untested live partner `READY` flow above.
4b. `DELIVERING WM-003` sent again (Woshman) → succeeded, transitioned to `out_for_delivery`. ✅
5. `DELIVERED WM-003 10pcs` → succeeded, transitioned to `delivered`. ✅

**Part E — feedback flow:** feedback prompt fired automatically on `DELIVERED`, as expected. Replied with score **3** (not the doc's suggested score 1) — a deliberate choice to exercise the urgent-escalation path instead. Got the correct holding message back ("Really sorry about that. Someone from the team will call you shortly."). ✅ for the live trigger (does `DELIVERED` genuinely land the session in `FEEDBACK_PENDING` with the prompt sent, and does a reply round-trip correctly) and specifically for the score-3 branch. Scores 1 and 2 remain verified only by `tests/conversation/states/feedback.test.ts` in isolation, per this file's original scope note — not re-tested live this pass, and a session can only be scored once, so covering them live would need two more complete orders driven to `DELIVERED`.

**Part F — deliberately wrong keyword messages:**
1. Malformed keyword (`COLLECTED` with no order number) → correctly rejected with the valid-formats list, no crash, no silence. ✅
2. `READY WM-___` from the Woshman's number → covered above under Part D, item 3. ✅
3. `COLLECTED WM-999` (nonexistent order) — tested live: exact reply was `"We don't have an order WM-999. Please check the order number and resend."` Clean rejection, matches `TRD.md` §4's requirement for unknown order IDs (no crash, no silence). Reply itself was delayed (same Render free-tier cold-start pattern noted below), but arrived correctly. ✅
4. Repeat `COLLECTED WM-___` after already past `picked_up` → covered above under Part D, item 1 (idempotency no-op path specifically, not the illegal-transition path — both are acceptable per the original table, and the no-op is what was actually hit). ✅

**Operational note — delayed WhatsApp replies:** several steps showed no immediate reply on WhatsApp. Independently confirmed via direct database checks (`messages`/`order_status_history` — see the conversation history around this PR for the exact queries) that every command succeeded on the backend within seconds; the WhatsApp replies were simply delayed. Consistent with Render free-tier cold-start behavior already flagged as a Phase 8 production-upgrade item, not a processing defect.

**Net result:** every explicitly-scoped item in Parts A–F passed, including Part F item 3, tested in a follow-up live check. One gap remains, carried forward openly rather than glossed over: the live partner-side `READY` success path (no second test number available) — logged in `docs/BUILD_LOG.md`'s Post-MVP tracker as needed before Phase 8a's supervised pilot, not blocking this PR.
