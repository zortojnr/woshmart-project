# Woshmart — User Journeys

Every actor's path through the system, end to end. Message copy referenced here is defined verbatim in `PRD.md` §10 — this document shows the *shape* of the journey, not a copy of the wording.

## 1. Customer journey (happy path)

```mermaid
flowchart TD
    A[Sends first WhatsApp message] --> B[Bot: Welcome + asks area]
    B --> C{In coverage zone?}
    C -- No --> D[Bot offers waitlist]
    D --> E{Accepts?}
    E -- Yes --> F[Logged as waitlist, conversation ends]
    E -- No --> Z[Conversation ends]
    C -- Yes --> G[Bot presents bundle menu]
    G --> H[Customer selects bundle]
    H --> I[Bot asks address + landmark]
    I --> J[Customer provides address]
    J --> K[Bot asks pickup window]
    K --> L[Customer selects window]
    L --> M[Bot asks payment method]
    M --> N[Customer selects: transfer or COD]
    N --> O[Bot sends itemized quote]
    O --> P{YES or NO?}
    P -- NO --> Q[Order not created, conversation ends]
    P -- YES --> R{Payment method}
    R -- Transfer --> S[Bot sends account details]
    S --> T[Customer sends receipt]
    T --> U[COO verifies manually - see COO journey]
    R -- COD --> V[Bot confirms COD, order proceeds to assignment]
    U --> W[Bot: dispatch confirmation]
    V --> W
    W --> X[Automatic status updates as Woshman/partner progress the order]
    X --> Y[Bot: delivered]
    Y --> AA[Bot sends feedback prompt]
    AA --> AB{Score}
    AB -- "1 - good" --> AC[Thank-you + referral nudge]
    AB -- "2 - issue" --> AD[Bot asks what went wrong, logged]
    AB -- "3 - problem" --> AE[COO tagged urgently, bot sends holding message]
```

### Customer — off-path branches

| Situation | What happens |
|---|---|
| No reply 30 min after quote sent | Order marked ABANDONED, timeout message sent, session resets |
| No payment receipt 45 min after YES (transfer) | One reminder sent |
| No payment receipt 60 min after YES (transfer) | Order marked ABANDONED, COO notified |
| Unmatched/unexpected reply mid-flow | Current prompt re-sent |
| 3 consecutive unmatched replies | Escalation message with MENU option, session flagged for COO visibility |
| Media sent when not expected | Polite "text only for now" + repeat of current prompt (exception: receipt image during AWAITING_PAYMENT is accepted) |
| Repeated door cancellations | Account progressively flagged — see `PRD.md` §11.6 — eventually requires prepayment or is blocked |

## 2. Woshman journey

```mermaid
flowchart TD
    A[COO assigns Woshman to order in Retool] --> B[Woshman receives dispatch brief via WhatsApp]
    B --> C[Woshman travels to customer, collects items]
    C --> D[Woshman counts items with customer, sends: COLLECTED order_id]
    D --> E[System sets order to PICKED_UP, notifies customer]
    E --> F[Woshman transports to partner laundry]
    F --> G[Woshman hands off, sends: LAUNDRY order_id]
    G --> H[System sets order to AT_LAUNDRY, notifies customer]
    H --> I[Partner processes items - see Partner journey]
    I --> J[Partner sends: READY order_id]
    J --> K[System alerts Woshman to collect]
    K --> L[Woshman collects from partner, sends: DELIVERING order_id]
    L --> M[System sets order to OUT_FOR_DELIVERY, notifies customer]
    M --> N[Woshman delivers, counts with customer, collects COD cash if applicable]
    N --> O[Woshman sends: DELIVERED order_id count pcs]
    O --> P[System sets order to DELIVERED, notifies customer + fires feedback prompt]
```

### Woshman — off-path branches

| Situation | What happens |
|---|---|
| Item count mismatch at pickup or laundry handover | Woshman calls COO immediately — not a WhatsApp keyword, a real call. COO adjusts order, customer confirms revised total before proceeding. |
| Sends malformed or unrecognized keyword | System replies with a clear correction request, no silent failure |
| Sends keyword that implies an illegal status jump (e.g. DELIVERED before PICKED_UP) | Rejected with a clear explanation, order status unchanged |
| Cannot make scheduled pickup | Calls COO — COO reassigns or reschedules with the customer |
| Suspects missing/damaged item | Reports to COO **before leaving the laundry** — never after |
| Door cancellation | Confirms with COO — Woshman receives the ₦150 travel fee, customer account gets flagged per `PRD.md` §11.6 |

## 3. Partner laundry journey

```mermaid
flowchart TD
    A[COO sends job notification via WhatsApp on assignment] --> B[Partner receives Woshman with items]
    B --> C[Partner counts items with Woshman, confirms on count sheet]
    C --> D[Partner processes: wash, iron, starch if flagged]
    D --> E{Meets internal 36hr target?}
    E -- Yes --> F[Partner sends: READY order_id]
    E -- At risk --> G[Partner notifies COO 6+ hrs before 48hr customer SLA]
    G --> H[COO proactively contacts customer with delay notice]
    H --> F
    F --> I[System alerts Woshman to collect - see Woshman journey]
```

### Partner — off-path branches

| Situation | What happens |
|---|---|
| Missing item discovered | Calls COO immediately — loss protocol activated (`PRD.md` §11.8) |
| Cannot do starch on a flagged order | Should have been excluded at onboarding — flagged partners aren't routed starch orders in the first place |
| Unreachable for an extended period | COO escalates to Founder, arranges transfer of items to a second partner |

## 4. COO / admin journey (Retool)

```mermaid
flowchart TD
    A[Customer sends bank transfer receipt] --> B[COO sees it in ops notification]
    B --> C[COO verifies against bank account within ~15 min]
    C --> D[COO marks order PAID in Retool]
    D --> E[System fires payment confirmation to customer]
    D --> F[COO assigns Woshman + partner in Retool]
    F --> G[System fires dispatch brief to Woshman + job brief to partner]
    G --> H[Order proceeds through Woshman/partner keyword updates automatically]
    H --> I{Anything escalated?}
    I -- ISSUE keyword / feedback score 3 / SLA risk --> J[COO investigates and resolves per PRD.md §11]
    I -- No --> K[Order reaches DELIVERED, then auto-CLOSED after 24hrs if no dispute]
    J --> L[COO updates order to DISPUTED, resolves, moves to CLOSED]
```

### COO — standing responsibilities (not event-triggered)

- Reviewing flagged/blocked account requests
- Editing Woshman/partner directory records
- Editing pricing config (`super_admin` only)
- Reviewing feedback log and marking items resolved
- Reviewing the audit log (`admin_actions`) periodically

## 5. Cross-actor sequence for one full order (reference)

```mermaid
sequenceDiagram
    participant C as Customer
    participant Bot as Woshmart Bot
    participant COO as COO (Retool)
    participant W as Woshman
    participant P as Partner Laundry

    C->>Bot: "Hi"
    Bot->>C: Welcome + area check
    C->>Bot: Area
    Bot->>C: Bundle menu
    C->>Bot: Bundle selection, address, pickup time, payment method
    Bot->>C: Quote
    C->>Bot: YES
    Bot->>C: Payment instructions
    C->>Bot: Receipt (image)
    Bot->>COO: Notify — receipt received
    COO->>COO: Verify transfer
    COO->>Bot: Mark PAID
    Bot->>C: Payment confirmed
    COO->>Bot: Assign Woshman + Partner
    Bot->>W: Dispatch brief
    Bot->>P: Job brief
    W->>Bot: "COLLECTED <id>"
    Bot->>C: Picked up notice
    W->>Bot: "LAUNDRY <id>"
    Bot->>C: At laundry notice
    P->>Bot: "READY <id>"
    Bot->>W: Alert to collect
    W->>Bot: "DELIVERING <id>"
    Bot->>C: Out for delivery notice
    W->>Bot: "DELIVERED <id> Npcs"
    Bot->>C: Delivered + feedback prompt
    C->>Bot: Feedback score
    Bot->>COO: (if score 3) Urgent escalation
```
