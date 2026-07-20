# Woshmart — Technical Requirements Document (TRD)

Companion to `PRD.md` (what/why) and `ARCHITECTURE.md` (system diagram, data flow, folder structure). This document defines *how* — stack, API contracts, schema, and non-functional requirements. `CLAUDE.md` is the enforcement layer on top of this.

## 1. Stack decisions

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js LTS | Team familiarity, Twilio SDK support |
| Language | TypeScript, strict mode | Type safety across many state transitions and webhook payloads |
| Framework | Express | NestJS's DI/module overhead isn't justified at this scale |
| ORM | Prisma | Type-safe queries, solid migration story |
| Database | PostgreSQL | Relational fit for orders/users/status; no NoSQL justification here |
| Queue | Redis + BullMQ | Session timeouts, sweeps, outbound throttling — small footprint |
| Validation | Zod | Request/webhook payload validation |
| Logging | Pino | Structured JSON logs, request-id correlation |
| Error tracking | Sentry (or equivalent) | Exception capture, PII-scrubbed |
| Testing | Vitest or Jest + Supertest | Unit + integration |
| Messaging channel | Twilio WhatsApp Business API | Sole customer/Woshman/partner channel |
| Admin frontend | Retool | Talks only to our Admin API, no direct DB access |

Do not substitute any of these without flagging it first (per `CLAUDE.md`).

## 2. Conversation engine design

Finite state machine, not NLU — the flow is fixed and scripted (`PRD.md` §10), so determinism and testability win over flexibility we don't need.

```typescript
type ConversationState =
  | 'WELCOME'
  | 'COVERAGE_CHECK'
  | 'SERVICE_SELECTION'
  | 'ADDRESS_COLLECTION'
  | 'PICKUP_TIME'
  | 'PAYMENT_METHOD'
  | 'QUOTE_PENDING'
  | 'AWAITING_PAYMENT'
  | 'FEEDBACK_PENDING'
  | 'IDLE';

interface StateHandler {
  handle(ctx: SessionContext, input: string): Promise<{
    nextState: ConversationState;
    outboundMessages: OutboundMessage[];
    sideEffects?: SideEffect[];
  }>;
}
```

Rules:
- Each state is a pure function (context + input → next state + messages + side effects). No direct DB/Twilio calls inside a handler — those are injected/called via services.
- The engine (`conversation/engine.ts`) only orchestrates: load session → dispatch to handler → persist → execute side effects → send.
- Payment confirmation via bank transfer is **not** a customer-input transition — it requires a COO action through the Admin API. A submitted receipt just holds the session; a human moves it to `PAID`.
- Woshman/partner inbound messages never enter this FSM — they're routed to the keyword parser before the FSM is reached (see §4).

## 3. State → PRD flow mapping

| FSM state | PRD flow step | On valid input |
|---|---|---|
| WELCOME | 1 | → COVERAGE_CHECK |
| COVERAGE_CHECK | 2 | in-zone → SERVICE_SELECTION; out-of-zone + accepts waitlist → IDLE, waitlist flag set |
| SERVICE_SELECTION | 3 | → ADDRESS_COLLECTION |
| ADDRESS_COLLECTION | 4 | → PICKUP_TIME |
| PICKUP_TIME | 5 | → PAYMENT_METHOD |
| PAYMENT_METHOD | 6 | → QUOTE_PENDING (quote generated + sent here) |
| QUOTE_PENDING | 7 | YES → order row created → AWAITING_PAYMENT (transfer) or IDLE (COD, pending admin assignment); NO → IDLE, no order created |
| AWAITING_PAYMENT | 8 | Receipt received → holds for COO verification (no auto-transition) |
| FEEDBACK_PENDING | 10 | Score 1/2/3 → logged → IDLE |

## 4. Keyword protocol (Woshman / partner)

Routing decision at the very top of the webhook handler:

```
inbound message
  → sender is a known Woshman number?  → keyword parser → order mutation
  → sender is a known Partner number?  → keyword parser → order mutation
  → else                                → customer conversation FSM
```

| Keyword | Sets status to | Notes |
|---|---|---|
| `COLLECTED <order_id>` | PICKED_UP | |
| `LAUNDRY <order_id>` | AT_LAUNDRY | |
| `READY <order_id>` | READY_FOR_DELIVERY | Sent by partner, not Woshman |
| `DELIVERING <order_id>` | OUT_FOR_DELIVERY | |
| `DELIVERED <order_id> <count>pcs` | DELIVERED | Logs item count, fires feedback prompt |
| `ISSUE <order_id> <note>` | Flags order, no status change | Escalates to COO immediately |

Every keyword action is validated against the order's *current* status before applying (see §9, state machine enforcement). Unknown order ID or malformed keyword → clear reply to the sender, never a silent drop.

## 5. API design

### 5.1 Webhook endpoints (Twilio-facing — authenticated via Twilio signature, not JWT)

| Method | Path | Purpose |
|---|---|---|
| POST | `/webhooks/twilio/inbound` | Inbound WhatsApp message — customer, Woshman, or partner |
| POST | `/webhooks/twilio/status` | Delivery/read status callbacks for outbound messages |

### 5.2 Admin API (Retool-facing — JWT + RBAC)

| Method | Path | Purpose | Min role |
|---|---|---|---|
| POST | `/admin/auth/login` | Admin login, returns JWT | — |
| GET | `/admin/orders` | List/filter orders | viewer |
| GET | `/admin/orders/:id` | Order detail + status history | viewer |
| PATCH | `/admin/orders/:id/status` | Manual status transition (validated) | ops |
| PATCH | `/admin/orders/:id/assign` | Assign Woshman + partner | ops |
| GET | `/admin/users` | List customers | viewer |
| PATCH | `/admin/users/:id/flag` | Set account status / prepayment flag | ops |
| GET | `/admin/woshmen` | List Woshmen | viewer |
| PATCH | `/admin/woshmen/:id` | Update Woshman record | ops |
| GET | `/admin/partners` | List partners | viewer |
| PATCH | `/admin/partners/:id` | Update partner record | ops |
| GET | `/admin/pricing` | Current pricing config | viewer |
| PATCH | `/admin/pricing` | Update pricing config | super_admin |
| POST | `/admin/messages/send` | Manual one-off customer message (via Notification Service) | ops |
| GET | `/admin/feedback` | List feedback entries | viewer |

Every write route is wrapped by the audit-log middleware (`admin_actions`) automatically — not opt-in per route.

### 5.3 Health

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Checks DB + Redis connectivity, used by uptime monitor |

## 6. Database schema

PostgreSQL via Prisma. Full DDL below — treat as the source of truth for the first migration.

```sql
CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number        TEXT UNIQUE NOT NULL,
    name                TEXT,
    first_order_at      TIMESTAMPTZ,
    last_order_at       TIMESTAMPTZ,
    total_orders        INTEGER NOT NULL DEFAULT 0,
    total_spend_kobo    BIGINT NOT NULL DEFAULT 0,
    referral_source     TEXT,
    account_status      TEXT NOT NULL DEFAULT 'active'
                         CHECK (account_status IN ('active','flagged','blocked')),
    prepayment_required BOOLEAN NOT NULL DEFAULT false,
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_phone ON users(phone_number);

CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number    TEXT UNIQUE NOT NULL,
    state           TEXT NOT NULL,
    context         JSONB NOT NULL DEFAULT '{}',
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sessions_phone ON sessions(phone_number);
CREATE INDEX idx_sessions_expires ON sessions(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE woshmen (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                      TEXT NOT NULL,
    phone_number              TEXT UNIQUE NOT NULL,
    availability              TEXT NOT NULL DEFAULT 'available'
                              CHECK (availability IN ('available','on_job','off_duty')),
    jobs_today                INTEGER NOT NULL DEFAULT 0,
    jobs_this_month           INTEGER NOT NULL DEFAULT 0,
    piece_rate_earnings_kobo  BIGINT NOT NULL DEFAULT 0,
    retainer_paid_this_month  BOOLEAN NOT NULL DEFAULT false,
    complaints_this_month     INTEGER NOT NULL DEFAULT 0,
    missing_items_this_month  INTEGER NOT NULL DEFAULT 0,
    active                    BOOLEAN NOT NULL DEFAULT true,
    joined_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE partners (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                     TEXT NOT NULL,
    address                  TEXT,
    contact_name             TEXT,
    phone_number             TEXT UNIQUE NOT NULL,
    capacity_per_day         INTEGER,
    can_do_starch            BOOLEAN NOT NULL DEFAULT false,
    can_do_express           BOOLEAN NOT NULL DEFAULT false,
    last_rating              NUMERIC(2,1),
    status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','warning','suspended')),
    outstanding_balance_kobo BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE orders (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number           TEXT UNIQUE NOT NULL,
    user_id                UUID NOT NULL REFERENCES users(id),
    address                TEXT NOT NULL,
    landmark               TEXT,
    zone                   TEXT NOT NULL,
    service_type           TEXT NOT NULL,
    items_description      TEXT,
    service_total_kobo     BIGINT NOT NULL,
    small_basket_fee_kobo  BIGINT NOT NULL DEFAULT 0,
    logistics_fee_kobo     BIGINT NOT NULL DEFAULT 0,
    grand_total_kobo       BIGINT NOT NULL,
    amount_paid_kobo       BIGINT NOT NULL DEFAULT 0,
    payment_method         TEXT NOT NULL CHECK (payment_method IN ('transfer','cod')),
    payment_status         TEXT NOT NULL DEFAULT 'pending'
                           CHECK (payment_status IN ('pending','confirmed','refunded')),
    pickup_date            DATE,
    pickup_window          TEXT,
    woshman_id             UUID REFERENCES woshmen(id),
    partner_id             UUID REFERENCES partners(id),
    status                 TEXT NOT NULL DEFAULT 'initiated'
                           CHECK (status IN (
                              'initiated','awaiting_confirmation','awaiting_payment','paid',
                              'assigned','pickup_scheduled','picked_up','at_laundry',
                              'ready_for_delivery','out_for_delivery','delivered',
                              'closed','cancelled','abandoned','disputed'
                           )),
    delivered_at           TIMESTAMPTZ,
    notes                  TEXT,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_woshman ON orders(woshman_id);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_status_created ON orders(status, created_at);

CREATE TABLE order_status_history (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES orders(id),
    from_status   TEXT,
    to_status     TEXT NOT NULL,
    changed_by    TEXT NOT NULL,        -- 'system' | 'admin:<id>' | 'woshman' | 'partner'
    note          TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_status_history_order ON order_status_history(order_id);

CREATE TABLE messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    twilio_sid      TEXT UNIQUE,
    direction       TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    phone_number    TEXT NOT NULL,
    order_id        UUID REFERENCES orders(id),
    body            TEXT,
    status          TEXT,
    raw_payload     JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_messages_phone ON messages(phone_number);
CREATE INDEX idx_messages_order ON messages(order_id);
CREATE INDEX idx_messages_twilio_sid ON messages(twilio_sid);

CREATE TABLE feedback (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id      UUID NOT NULL REFERENCES orders(id),
    score         SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 3),
    text          TEXT,
    resolved      TEXT NOT NULL DEFAULT 'n/a' CHECK (resolved IN ('yes','no','n/a')),
    coo_notes     TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admins (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'ops'
                    CHECK (role IN ('super_admin','ops','viewer')),
    active          BOOLEAN NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_actions (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id      UUID NOT NULL REFERENCES admins(id),
    action        TEXT NOT NULL,
    entity_type   TEXT NOT NULL,
    entity_id     UUID,
    before_value  JSONB,
    after_value   JSONB,
    ip_address    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pricing_config (
    key           TEXT PRIMARY KEY,
    value         JSONB NOT NULL,
    updated_by    UUID REFERENCES admins(id),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Money is always `BIGINT` kobo. Never introduce a `NUMERIC`/`float` currency column.

## 7. Non-functional requirements

| Category | Requirement |
|---|---|
| **Security** | Twilio signature validation on every webhook; JWT + RBAC on every Admin API route; all inputs Zod-validated; no raw SQL string concatenation; secrets only in env/secret manager, never committed |
| **Idempotency** | Every webhook and job handler safe to run twice with the same input; `MessageSid`/order-id/keyword combination checked before processing |
| **Data integrity** | Order status transitions validated against a fixed legal-transition graph; illegal transitions rejected, not silently allowed |
| **Auditability** | Every Admin API write captured in `admin_actions` with before/after values, automatically via middleware |
| **Reliability** | Transient failures (network, 5xx, timeout) retry with backoff; permanent failures logged and surfaced, not retried indefinitely; dead-letter handling for jobs that exhaust retries |
| **Alerting** | Urgent/paging alerts reserved for: API fully down, DB unreachable, payment/data-integrity issues. Everything else (individual send failures, single job retries) is visible in logs/Retool for business-hours review, not paged |
| **Money handling** | Integer kobo everywhere, no float/NUMERIC currency types |
| **PII handling** | Message bodies not logged at `info` level in a way that ends up unrestricted in long-retention logs; receipt images (if stored) in a private object store with signed URLs only |
| **Backups** | Automated daily Postgres backups, minimum 7-day retention (30-day preferred), point-in-time recovery enabled, periodic test restores |
| **Rate limiting** | Per-phone-number limit on webhook processing; global webhook rate limit; Admin API rate limit per admin/IP; outbound Twilio sends throttled to respect WhatsApp Business API tier limits |
| **Environment isolation** | Dev/staging/production never share secrets, databases, or Twilio senders |
| **Performance** | No explicit SLA at MVP scale (low hundreds of orders/month) — correctness and idempotency prioritized over latency optimization; revisit only if real usage data shows a bottleneck |

## 8. What NOT to build (see also PRD.md §13)

Microservices, GraphQL, multi-region deployment, read replicas, payment gateway integration, custom admin frontend, third-party workflow-automation tooling, Google Maps/geocoding. All explicitly premature or out of scope — do not add speculatively.

## 9. State transition enforcement

Order status changes must go through a single service function that checks the attempted transition against this legal-transition table before writing:

```
initiated              → awaiting_confirmation, abandoned, cancelled
awaiting_confirmation   → awaiting_payment, abandoned, cancelled
awaiting_payment        → paid, abandoned, cancelled
paid                    → assigned, cancelled, disputed
assigned                → pickup_scheduled, cancelled
pickup_scheduled        → picked_up, cancelled
picked_up               → at_laundry, disputed
at_laundry              → ready_for_delivery, disputed
ready_for_delivery      → out_for_delivery, disputed
out_for_delivery        → delivered, disputed
delivered               → closed, disputed
disputed                → closed, cancelled   (reopens via COO resolution)
```

Any transition not in this table is rejected with a clear error, logged, and does not silently succeed. Nothing outside this function writes to `orders.status`.
