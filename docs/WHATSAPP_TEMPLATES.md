# Woshmart — WhatsApp Message Templates (ready to submit)

Prepared so template submission isn't a second delay once the production number clears Meta's business verification (`docs/PHASE_8_LAUNCH_READINESS_SUMMARY.md` §1). Submit these to Meta Business Manager the day the number is approved — nothing here depends on that approval to be written or reviewed.

**Why these two specifically:** every other outbound customer message either fires as a direct reply within the same conversation the customer just initiated (session message, no template needed) or doesn't exist in code yet (stale-session nudge, Phase 9+). Delivery notice and feedback nudge are the two real-code messages that can genuinely fire outside the customer's 24h session window in normal order timing — see the launch-readiness summary for the reasoning.

Both use the exact existing copy from `src/conversation/messages.ts` — per CLAUDE.md rule 7, template text is not a place to improve or rewrite wording. Neither currently references the order number, so neither needs a variable as worded; if Meta's review pushes back requiring personalization, the order number (`{{1}}`) is the natural addition, but that's a change to make only if actually required, not preemptively.

## Template 1 — Delivery notice

| Field | Value |
|---|---|
| Template name | `order_delivered_notice` |
| Category | Utility |
| Language | English |
| Body | `Your clothes are home! 🧺 Thanks for using Woshmart.` |
| Variables | None |
| Source of this exact text | `src/conversation/messages.ts`, `STATUS_UPDATE_MESSAGES.delivered` |

## Template 2 — Feedback nudge

| Field | Value |
|---|---|
| Template name | `order_feedback_request` |
| Category | Utility |
| Language | English |
| Body | `Quick one — how did we do?\n1. All good 👍\n2. Had a small issue\n3. Something went wrong — please call me` |
| Variables | None |
| Source of this exact text | `src/conversation/messages.ts`, `FEEDBACK_PROMPT_MESSAGE` |

Note for submission: this template's reply is a plain numeric text reply (customer types `1`/`2`/`3`), not WhatsApp's structured quick-reply buttons — the existing conversation FSM (`src/conversation/states/feedback.ts`) parses free-text `1`/`2`/`3` only. Submit as a plain body template, not a button template, unless you deliberately want to also change the customer-reply handling to match (a separate piece of work, not assumed here).

## After approval — activating the fallback

Once each template is approved and its Twilio Content resource exists (Twilio Console → Content Template Builder, or synced automatically depending on your Twilio/Meta integration setup), copy that Content SID into the corresponding environment variable — no code change needed, `src/domain/notifications/notification.service.ts` already reads these:

| Env var | Which template |
|---|---|
| `TWILIO_CONTENT_SID_DELIVERY_NOTICE` | Template 1 above |
| `TWILIO_CONTENT_SID_FEEDBACK_NUDGE` | Template 2 above |

Until each is set, that specific message keeps sending as free text (today's existing behavior — not worse, not blocking launch on template approval, but still carrying the session-window risk described in the launch-readiness summary). `notification.service.ts` logs an info-level line each time a send falls back to free text specifically because its template isn't configured yet — once you set the env var and that log line stops appearing for that message, that's the concrete signal the fallback is no longer in play for it.
