# Woshmart — Architecture

Companion to `PRD.md` (what/why) and `TRD.md` (API/schema/NFRs). This document is the system shape: components, data flow, folder layout, and deployment topology.

## 1. System diagram

```
                                   ┌─────────────────────┐
                                   │   Customer (WhatsApp)│
                                   └──────────┬───────────┘
                                              │ inbound/outbound msg
                                              ▼
                                   ┌─────────────────────┐
                                   │   Twilio WhatsApp    │
                                   │   Business API       │
                                   └──────────┬───────────┘
                              webhook (POST)  │  ▲ REST API (send msg)
                                              ▼  │
┌───────────────────────────────────────────────────────────────────┐
│                        WOSHMART BACKEND (Node.js)                  │
│                                                                      │
│  ┌────────────┐   ┌────────────────┐   ┌────────────────────────┐ │
│  │  Webhook    │──▶│  Conversation   │──▶│   Domain Services       │ │
│  │  Controller │   │  Engine (FSM)   │   │  (Orders, Users,         │ │
│  │  (Twilio    │   │                 │   │   Pricing, Zones,        │ │
│  │  signature  │   │  state per      │   │   Notifications)         │ │
│  │  validation)│   │  phone number   │   │                          │ │
│  └────────────┘   └────────────────┘   └───────────┬──────────────┘ │
│                                                       │                │
│  ┌────────────────────────────┐   ┌─────────────────▼──────────────┐│
│  │   Admin API (for Retool)    │   │   Messaging Service              ││
│  │   — REST, JWT-auth'd         │   │   (queues + sends via Twilio)   ││
│  └──────────────┬───────────────┘   └─────────────────┬──────────────┘│
└─────────────────┼──────────────────────────────────────┼──────────────┘
                   │                                      │
                   ▼                                      ▼
        ┌─────────────────────┐                ┌─────────────────────┐
        │   PostgreSQL          │                │   Redis / BullMQ      │
        │   (source of truth)   │                │   — timeouts, sweeps, │
        │                       │                │   outbound queueing   │
        └───────────┬───────────┘                └─────────────────────┘
                    │
                    ▼
        ┌─────────────────────┐
        │   Retool Dashboard    │  (COO/ops — orders, users, status,
        │   → Admin API only     │   manual triggers, pricing config)
        └─────────────────────┘
```

## 2. Component responsibilities

| Component | Responsibility |
|---|---|
| Webhook controller | Validate Twilio signature, deduplicate by `MessageSid`, route to keyword parser or conversation FSM, respond `200` fast |
| Conversation engine (FSM) | Own per-customer conversation state, apply the correct state handler, produce next state + outbound messages + side effects |
| Keyword parser | Recognize Woshman/partner sender numbers, parse structured keyword messages, translate to order mutations |
| Domain services | Business logic — Orders, Users, Pricing, Zones, Woshmen, Partners — independent of WhatsApp/Twilio specifics |
| Notification service | Single fan-out point for every outbound "event" (order confirmed, delivered, etc.) — called by both the FSM and the Admin API |
| Messaging service | Thin wrapper over Twilio's send API — owns retry/backoff and outbound throttling |
| Admin API | REST surface for Retool only — auth, RBAC, audit logging on every write |
| PostgreSQL | Single source of truth for all persistent state |
| Redis / BullMQ | Session timeout jobs, scheduled sweeps (stale sessions, auto-close), outbound queueing |
| Retool | Admin frontend — talks only to the Admin API, never direct DB access |

## 3. Data flow: inbound message → response → storage

1. Customer/Woshman/partner sends WhatsApp message → Twilio → `POST /webhooks/twilio/inbound`.
2. Signature validated (`X-Twilio-Signature`), `MessageSid` checked for duplicates, `200 OK` returned immediately.
3. Sender-type routing: known Woshman/partner number → keyword parser; else → conversation FSM.
4. FSM loads session state from Postgres (keyed by phone number), applies the relevant state handler.
5. Handler calls domain service(s) (e.g. `PricingService.calculateQuote()`, `OrderService.createOrder()`), which write to Postgres inside a transaction.
6. Handler returns next state + outbound message(s); engine persists new session state.
7. Outbound message(s) passed to Notification → Messaging service → sent via Twilio REST API, logged to `messages`.
8. Retool actions (e.g. COO marks PAID) go through the Admin API, which calls the same Notification Service — one fan-out point regardless of trigger source.

## 4. Folder structure

```
woshmart-backend/
├── src/
│   ├── config/
│   │   ├── env.ts                # validated env var loading (fails fast)
│   │   └── constants.ts          # non-secret config (timeouts, zones, etc.)
│   │
│   ├── webhooks/
│   │   ├── twilio.controller.ts
│   │   └── twilio.validate.ts
│   │
│   ├── conversation/
│   │   ├── engine.ts
│   │   ├── states/
│   │   │   ├── welcome.ts
│   │   │   ├── coverageCheck.ts
│   │   │   ├── serviceSelection.ts
│   │   │   ├── addressCollection.ts
│   │   │   ├── pickupTime.ts
│   │   │   ├── paymentMethod.ts
│   │   │   ├── quote.ts
│   │   │   ├── payment.ts
│   │   │   └── feedback.ts
│   │   └── messages.ts           # message copy — kept out of logic files, matches PRD.md §10 exactly
│   │
│   ├── domain/
│   │   ├── orders/
│   │   │   ├── order.service.ts
│   │   │   ├── order.repository.ts
│   │   │   ├── order.statemachine.ts   # legal-transition enforcement (TRD.md §9)
│   │   │   └── order.types.ts
│   │   ├── users/
│   │   ├── pricing/
│   │   │   ├── pricing.service.ts
│   │   │   └── bundles.config.ts
│   │   ├── zones/
│   │   ├── woshmen/
│   │   ├── partners/
│   │   └── notifications/
│   │       └── notification.service.ts
│   │
│   ├── messaging/
│   │   ├── twilio.client.ts
│   │   ├── send.service.ts
│   │   └── keyword.parser.ts
│   │
│   ├── admin-api/
│   │   ├── routes/
│   │   ├── middleware/
│   │   │   ├── auth.middleware.ts
│   │   │   ├── rbac.middleware.ts
│   │   │   └── audit.middleware.ts
│   │   └── controllers/
│   │
│   ├── jobs/
│   │   ├── queue.ts
│   │   ├── sessionTimeout.job.ts
│   │   ├── staleSessionSweep.job.ts
│   │   └── autoClose.job.ts
│   │
│   ├── db/
│   │   ├── prisma/schema.prisma
│   │   └── client.ts
│   │
│   ├── lib/
│   │   ├── logger.ts
│   │   ├── errors.ts
│   │   └── rateLimiter.ts
│   │
│   ├── app.ts
│   └── server.ts
│
├── tests/
├── docs/
│   ├── PRD.md
│   ├── TRD.md
│   ├── ARCHITECTURE.md
│   └── BUILD_SCRIPT.md
├── CLAUDE.md
├── .env.example
├── prisma/migrations/
├── package.json
└── tsconfig.json
```

## 5. Deployment topology

| Environment | Backend | Database | Redis | Twilio sender |
|---|---|---|---|---|
| Development | Local process | Neon (managed Postgres, free tier) | Upstash (managed Redis, free tier) | Sandbox |
| Staging | Hosted on Render (Web Service) | Render Postgres (separate instance) | Render Key Value (separate instance) | Dedicated staging sender |
| Production | Hosted on Render (Web Service, same platform as staging) | Render Postgres (separate instance, backups on) | Render Key Value (separate instance) | Production business number |

- Dedicated subdomain for the API (e.g. `api.woshmart.com`), managed/auto-renewing TLS cert.
- Retool connects to the Admin API URL for the relevant environment — staging first, production only once Admin API auth/RBAC is verified.
- No environment shares secrets, credentials, or a Twilio sender with another.

## 6. Scalability notes

Current real scale: low hundreds of orders/month, single city. Architecture choices reflect that:
- Single stateless backend process — session state lives in Postgres/Redis, not memory, so horizontal scaling later is a config change, not a rewrite.
- Webhook handler does validation + routing synchronously; heavy work can run inline at this volume, but the function boundaries are clean enough to move to a real queue consumer later without restructuring.
- All outbound sends funnel through one Messaging Service, so rate limiting/backoff lives in exactly one place.
- Explicitly not building: microservices, multi-region, read replicas, GraphQL. Revisit only when real usage data justifies it (see TRD.md §8).
