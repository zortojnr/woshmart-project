
# Woshmart — Product Requirements Document (PRD)

**Status:** Canonical for build. Supersedes any earlier PRD drafts that mention Retool-only-with-Paystack, n8n, or an 8-state lifecycle — this document reflects the confirmed real build.

## 1. Product overview

Woshmart is a WhatsApp-based laundry ordering and operations system. Customers order, get pricing, schedule pickup/delivery, receive status updates, and give feedback — entirely inside a WhatsApp conversation. Internally, operations run through a Retool admin dashboard backed by our API. There is no customer-facing app of any kind and no payment gateway; payment is bank transfer (manually verified) or cash on delivery.

## 2. Goals (MVP)

- Standardize pricing across all orders
- Remove friction in ordering — no calls, no app download, no manual coordination
- Automate order intake and status communication end-to-end for the standard path
- Give the COO clear operational visibility and control via Retool
- Build a foundation that can later add per-item pricing, more zones, and (eventually) automated payments without a rebuild

## 3. Users

- **Customer** — orders via WhatsApp only.
- **Woshman** (pickup/delivery courier) — communicates via WhatsApp keyword messages to the same business number, no separate app or login.
- **Partner laundry** — same, via WhatsApp keyword messages.
- **COO / Ops admin** — uses Retool, backed by the Admin API. Day-to-day operator role.
- **Super admin** — Retool, full access including pricing config and admin account management.
- **Viewer** — Retool, read-only.

## 4. Core user flow (customer)

1. Customer sends any message → bot greets, asks area
2. Coverage check → in zone: bundle menu; out of zone: waitlist offer
3. Customer selects bundle
4. Customer provides address + landmark
5. Customer selects pickup window
6. Customer selects payment method (bank transfer or COD)
7. Bot generates itemized quote, customer replies YES/NO
8. YES → payment flow (transfer instructions, or COD confirmation) → order created
9. Standard status updates follow automatically as Woshmen/partners send keyword updates
10. On delivery, feedback prompt sent automatically

## 5. Admin flow (Retool via Admin API)

COO can: view/filter all orders, view order detail + status history, verify bank transfers and mark orders PAID, assign Woshman + partner laundry, manually transition/override order status, view and edit customer records (including flagging/blocking), view and edit Woshman and partner directories, send one-off manual messages to a customer, view feedback log. Super admin additionally: edit pricing config, manage admin accounts.

## 6. Pricing

### 6.1 Bundles (primary product — Phase 1 is bundle-only)

| Bundle | Includes | Price |
|---|---|---|
| Starter | 10 regular items | ₦2,000 |
| Weekly | 20 regular items | ₦3,800 |
| Family | 30 regular items | ₦5,500 |
| Household | 10 items + bedsheet + 2 pillowcases | ₦3,000 |

Regular items = shirts, trousers, t-shirts, blouses, shorts. Special items (suits, agbada, curtains) don't count toward bundle piece totals and are priced separately.

### 6.2 Per-item pricing (Phase 2 — inactive at MVP launch)

| Item | Unit | Price |
|---|---|---|
| Shirt / Blouse | piece | ₦300 |
| Trouser / Skirt | piece | ₦350 |
| T-shirt | piece | ₦200 |
| Shorts | piece | ₦250 |
| Singlet | piece | ₦150 |
| Underwear | piece | ₦200 |
| Socks | pair | ₦150 |
| Senator / Kaftan | set | ₦800 |
| Agbada (3-piece) | set | ₦1,500 |
| Suit (2-piece) | set | ₦1,500 |
| Blazer | piece | ₦750 |
| Jalabiya | piece | ₦800 |
| Simple dress | piece | ₦400 |
| Embroidered/lace dress | piece | ₦900 |
| Officer uniform | set | ₦700 |
| Bedsheet (single) | piece | ₦500 |
| Bedsheet (double) | piece | ₦600 |
| Pillowcase | piece | ₦150 |
| Duvet (single) | piece | ₦2,500 |
| Duvet (double) | piece | ₦3,000 |
| Towel (hand) | piece | ₦300 |
| Towel (bath) | piece | ₦500 |
| Curtain panel | panel | ₦500 |
| Jacket | piece | ₦500 |
| Shoes | pair | ₦1,000 |

### 6.3 Fees and modifiers

| Item | Rule |
|---|---|
| Pickup fee | ₦500 |
| Delivery fee | ₦500 |
| Round-trip logistics | ₦1,000 |
| Free logistics threshold | Orders above **₦5,000** service total (this value appears as ₦5,000 in the config table and ₦10,000 in one earlier draft section — **₦5,000 is authoritative**; flag if you find the ₦10,000 figure anywhere else) |
| Small basket surcharge | ₦500 on orders under ₦1,500 service total — **Phase 2 only**, inactive at MVP launch |
| Wash only (no iron) | −20% on service total |
| Iron only (pre-washed) | 60% of item price |
| Express | +50% on service total |
| Starch (light or hard) | +₦100 per item — customer flags at booking |

### 6.4 Minimum order value

- **Phase 1 (soft launch):** bundle-only, no per-item minimum logic active.
- **Phase 2+:** small basket surcharge above applies.

## 7. Coverage zones (Phase 1)

| Zone | Status |
|---|---|
| Maitumbi | Full coverage |
| Bosso | Full coverage |
| Tunga (Tunga proper + New Tunga) | Full coverage |
| Mobil area | Full coverage |
| Kpakungu | Waitlist only |
| Chanchaga | Not available — Phase 2 |

Coverage is determined by keyword-matching the customer's stated area against this list — no geocoding/maps API in Phase 1.

## 8. Business hours & timing

| Setting | Value |
|---|---|
| Operating hours | 7:00 AM – 7:00 PM daily |
| Quote confirmation timeout | 30 minutes (order marked ABANDONED if no YES reply) |
| Payment confirmation window (transfer only) | 60 minutes from YES, one reminder sent at 45 minutes |
| Standard turnaround SLA | 48 hours from pickup |
| Express turnaround SLA | 24 hours from pickup |
| Partner laundry internal target | 36 hours (12-hour buffer before customer SLA) |

## 9. Order status lifecycle (14 states)

| Status | Set by | Trigger |
|---|---|---|
| INITIATED | System | First message received |
| AWAITING_CONFIRMATION | System | Quote sent, awaiting YES/NO |
| AWAITING_PAYMENT | System | YES received — payment request sent (transfer) or order confirmed (COD) |
| PAID | COO | Manual transfer verification confirmed |
| ASSIGNED | COO | Woshman + partner assigned |
| PICKUP_SCHEDULED | COO | Pickup time confirmed |
| PICKED_UP | COO (via Woshman keyword) | Woshman confirms collection |
| AT_LAUNDRY | COO (via Woshman keyword) | Woshman confirms handover to partner |
| READY_FOR_DELIVERY | COO (via partner keyword) | Partner confirms items ready |
| OUT_FOR_DELIVERY | COO (via Woshman keyword) | Woshman confirms collection from laundry |
| DELIVERED | COO (via Woshman keyword) | Woshman confirms delivery |
| CLOSED | System or COO | Feedback received, or 24hrs post-delivery with no dispute |
| CANCELLED | COO or system | Customer cancels before pickup complete |
| ABANDONED | System | Timeout — no confirmation or no payment in window |
| DISPUTED | COO | Quality complaint or loss/damage report |

Legal transitions only — enforced in code, not convention (see TRD.md).

## 10. Message copy (exact — do not paraphrase)

**Welcome**
> "Hi! 👋 You've reached Woshmart. We pick up your clothes, wash and iron everything, and bring them back within 48 hours. Which area of Minna are you in?"

**Coverage confirmed**
> "We cover [area]! Here's what we offer:
> 1. Starter Bundle — 10 items for ₦2,000
> 2. Weekly Bundle — 20 items for ₦3,800
> 3. Family Bundle — 30 items for ₦5,500
> 4. Household Bundle — 10 items + bedsheet + 2 pillowcases for ₦3,000
> Reply 1, 2, 3, or 4."

**Out of coverage**
> "We're not in [area] yet — but we're expanding. Want us to add you to the list and message you when we get there? Reply YES and we'll keep you posted."

**Address request**
> "[Bundle name] for ₦[price] — noted. What's your address? Drop a landmark too so our Woshman finds you fast."

**Pickup time**
> "When works for pickup?
> 1. Today (morning — 7AM–12PM)
> 2. Today (afternoon — 12PM–4PM)
> 3. Today (evening — 4PM–7PM)
> 4. Tomorrow morning
> 5. Tomorrow afternoon
> Reply 1–5."

**Payment method**
> "How are you paying?
> 1. Bank transfer
> 2. Cash on delivery
> Reply 1 or 2."

**Quote**
> "Here's your summary:
> [Bundle name] — [X] items — ₦[price]
> [Small basket fee — ₦500] (only if applicable)
> Pickup + delivery — ₦1,000
> Total — ₦[grand total]
> Reply YES to confirm. Reply NO to cancel."

**Bank transfer instructions**
> "Send ₦[total] to:
> [Bank name] | [Account number] | Woshmart
> Send your receipt here once done — we'll confirm and get your Woshman moving."

**COD confirmation**
> "Your Woshman will collect ₦[total] cash when they deliver. They'll be with you by [time window] — have your items ready."

**Dispatch confirmation**
> "Got your payment — we're good to go. [Name] is your Woshman and they're heading to you now. We'll update you as things move."

**Status updates** (fired automatically on Woshman/partner keyword — see TRD.md §Keyword protocol)
- PICKED_UP: "Your clothes have been picked up and are heading to the laundry. ✅"
- AT_LAUNDRY: "Your clothes are at the laundry — washing and ironing in progress. We'll ping you when they're heading back."
- OUT_FOR_DELIVERY: "[Name] is on the way with your clothes. Should be with you soon."
- DELIVERED: "Your clothes are home! 🧺 Thanks for using Woshmart."

**Feedback prompt**
> "Quick one — how did we do?
> 1. All good 👍
> 2. Had a small issue
> 3. Something went wrong — please call me
> Takes 5 seconds."
- On 1: "Glad to hear it! 🙌 Know anyone who needs laundry sorted? Refer them and your next pickup is on us."
- On 2: "Noted — what could we have done better?"
- On 3: customer gets "Really sorry about that. Someone from the team will call you shortly." — COO tagged immediately, urgent.

**Timeouts**
- 30-min quote abandon: "Your order has timed out. Message us anytime to start again."
- 45-min payment reminder: "Did your transfer go through? Reply with your receipt when ready."

## 11. Business rules

### 11.1 Outside coverage
Bot declines, offers waitlist. COO not notified unless customer accepts. Accepted waitlist entries are logged against the customer record.

### 11.2 No-reply timeouts
See §8 and §10 (timeout messages). No COO notification for a mid-flow timeout; COO is notified once an order is ABANDONED after a payment-window timeout specifically.

### 11.2a Off-topic and unrelated messages (decision confirmed)
Off-topic messages (questions or content unrelated to laundry ordering) are **not** given dedicated detection or a distinct redirect message. They are handled identically to any other unmatched/unrecognized input mid-flow: the bot re-sends the current stage's question, and 3 consecutive unmatched replies triggers the standard escalation (MENU option + session flagged for COO visibility). This was a deliberate choice, not an oversight — reliably distinguishing "off-topic" from "malformed but on-topic" input is hard to do well with the deterministic FSM this system uses, and building dedicated detection before seeing real pilot transcripts risks solving the wrong problem. Revisit after Phase 8a's supervised pilot provides real examples of what customers actually send, if it turns out to matter in practice.

### 11.3 Payment verification & disputes
All verification is manual (no gateway). COO has ~15 minutes to review a submitted receipt before the bot follows up. Wrong-amount transfers: COO contacts customer directly, order stays AWAITING_PAYMENT until resolved.

### 11.4 Cancellations
| When | Rule | Refund |
|---|---|---|
| Before YES / no payment | Cancelled, no charge | N/A |
| After YES, before payment confirmed | Cancelled, no charge | N/A |
| After payment, before pickup | Customer may cancel | Full refund within 48 hrs |
| After pickup | Not accepted — items proceed | None |
| Post-delivery quality dispute | COO investigates within 24 hrs | Partial refund or free redo, case by case |

### 11.5 Item count discrepancies
Woshman calls COO immediately on any count mismatch at pickup or at laundry handover. Woshman's count sheet is the record of truth for disputes. Customer must confirm any adjusted total before the Woshman proceeds.

### 11.6 Repeated cancellations / problem accounts
| Event | Action |
|---|---|
| 1st door cancellation | ₦150 travel fee to Woshman from ops budget; account flagged Prepayment Required |
| 2nd door cancellation | Account flagged Manual Review — COO approves every order before dispatch |
| 3rd door cancellation / confirmed fraud | Account blocked |

Prepayment-required accounts get a modified quote flow requiring receipt before the quote is generated.

### 11.7 Partner laundry issues
SLA-risk situations are escalated to COO by the partner directly; COO calls the customer proactively rather than letting the deadline pass silently. Missing item reports trigger the loss protocol (§11.8).

### 11.8 Missing/damaged item protocol
Woshman/partner reports to COO before leaving the laundry, never after. COO searches immediately; if unresolved within 2 hours, COO proactively contacts the customer with a 24-hour resolution commitment. Confirmed loss: Woshmart pays replacement at fair market value, cost split by where the loss occurred per the count sheet record.

### 11.9 Starch
Customer flags at booking (light or hard) — bot adds ₦100/item. Partners incapable of starch are flagged in the partner directory and starch orders are not routed to them.

## 12. Notification matrix

| Event | Customer | COO | Woshman | Partner |
|---|---|---|---|---|
| New order confirmed (YES) | ✅ | ✅ | ❌ | ❌ |
| Bank transfer verified (PAID) | ✅ | — (COO acted) | ✅ dispatch brief | ✅ job brief |
| COD order confirmed | ✅ | ✅ | ✅ (on assignment) | ✅ (on assignment) |
| Woshman keyword: COLLECTED | ✅ | ❌ | ❌ | ❌ |
| Woshman keyword: LAUNDRY | ✅ | ❌ | ❌ | ❌ |
| Partner keyword: READY | ❌ | ❌ | ✅ alert | ❌ |
| Woshman keyword: DELIVERING | ✅ | ❌ | ❌ | ❌ |
| Woshman keyword: DELIVERED | ✅ + feedback prompt | ✅ | ❌ | ❌ |
| Feedback score 1–2 | ✅ reply | ✅ logged | ❌ | ❌ |
| Feedback score 3 | ✅ holding message | ✅ urgent tag | ❌ | ❌ |
| Order abandoned | ✅ timeout message | ✅ | ❌ | ❌ |
| Door cancellation (ISSUE) | ❌ | ✅ immediate | ✅ fee confirmed | ❌ |
| Partner SLA breach warning | ✅ delay notice | ✅ | ❌ | ✅ |

## 13. Explicitly out of scope (Phase 1 and 2)

- Payment gateway / any automated payment method
- Customer mobile or web app
- Admin panel outside Retool
- Google Maps / geocoding zone verification
- SMS or email channels
- Inventory/stock management
- Automated Woshman assignment (COO assigns manually by design)
- Any third-party workflow-automation tool (n8n or similar) — all logic is custom backend code

## 14. Success metrics

| Metric | Target |
|---|---|
| Completed orders — Month 1 | 50 |
| Completed orders — Month 2 | 100 |
| Completed orders — Month 3 | 200 |
| Repeat usage within 14 days | Above 40% |
| Lost items — Month 1 | 0 |
| Late deliveries (missed 48hr SLA) | Below 5% |
| Automated order intake rate (no COO intervention before PAID) | 95%+ |
| Average time INITIATED → PAID | Below 10 minutes |
| False escalations to COO | Below 10% |
