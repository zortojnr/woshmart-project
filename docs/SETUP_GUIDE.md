# Woshmart — Setup Guide

Everything in this document should be done **before** Claude Code (or anyone) opens the Phase 0 prompt in `BUILD_SCRIPT.md`. Nothing in Phase 1 onward should require a mid-build pause to go set something up — that's what causes rushed, unreviewed decisions made under pressure to "unblock the build," which is exactly the kind of shortcut that shouldn't happen on a real system.

Work through this in order. Check every box before moving to Phase 0.

## 0. Who owns what

Assign these explicitly before starting — "someone will figure it out" is how the Meta approval ends up not submitted until week 3.

| Role | Owns | Notes |
|---|---|---|
| Founder / COO | Business accounts, Meta Business Profile, bank account for transfers, Woshman/partner onboarding | Non-technical steps, but on the critical path — see §1 |
| Engineering lead | Infrastructure, repo, secrets, environments | Everything in §2–§6 |
| A second technical reviewer | Reviewing PRs, especially Phases 1/3/5/7 per `CLAUDE.md` | Must exist before Phase 1 starts — see `CLAUDE.md`'s human-review rule. If this is a solo build, find someone (a freelance senior engineer, a technical advisor) before you're deep into a phase that needs their eyes. Don't discover this gap at Phase 1's PR. |

## 1. Accounts & business setup

| Item | Action | Owner | Lead time |
|---|---|---|---|
| Meta Business Manager account | Create if it doesn't exist for the business | Founder/COO | Same day |
| WhatsApp Business Profile | Submit via Twilio Console — business name, category, description, logo, official business phone number. Have business registration documents ready; vague/incomplete profiles get rejected. | Founder/COO + Eng | **1–3 business days — start this literally first, before anything else in this guide** |
| Dedicated business phone number | Acquire a number that is not a personal line — this is what WhatsApp will be permanently tied to and should survive a change of who's running ops | Founder/COO | Same day |
| Twilio account | Create, verify, add a payment method | Eng | Same day |
| Twilio WhatsApp Sandbox | Activate for dev/testing — doesn't wait on Meta approval | Eng | Same day |
| Staging WhatsApp sender | A second number (or continue using the sandbox) dedicated to staging, never customer-facing | Eng | Same day |
| Bank account for transfer payments | Confirmed and ready — this is the account customers will be told to send money to | Founder/COO | Should already exist |

**Do not wait for Meta approval to start building.** Sandbox testing covers Phases 0–7 entirely. Meta approval only blocks the actual production WhatsApp number going live (Phase 8/8a).

## 2. Infrastructure

| Item | Recommendation | Notes |
|---|---|---|
| Hosting (backend) | **Render** (confirmed choice) — Web Service for the backend, on both staging and production | Managed platform, no server maintenance. Free tier available for early testing; upgrade to a paid instance type before Phase 8 to avoid free-tier spin-down delays affecting real customers |
| Database | **Neon** for dev (already set up, free tier); **Render Postgres** for staging and production — keeping the DB on the same platform as the backend gives lower latency via Render's private network and one dashboard to manage | Confirm automated backups are on for the production instance (Render Postgres includes daily backups on paid plans — verify the plan tier covers this), and confirm point-in-time recovery is available |
| Redis | **Upstash** for dev (already set up, free tier); **Render Key Value** for staging and production — same private-network reasoning as the database | Small footprint, don't over-provision |
| Object storage (only if storing receipt images) | S3 or equivalent, private bucket, signed URLs only | Decide explicitly whether this is in scope before Phase 3 — see `docs/SECURITY.md` §3.6 |
| Domain | Dedicated subdomain for the API (`api.woshmart.com` or similar) | Don't launch on a raw hosting-platform URL |
| TLS | Managed/auto-renewing cert via hosting platform | Twilio rejects self-signed certs — verify this works before Phase 0 exit |

## 3. Environments

Set up all three **before** any code assumes any of them exist:

| Environment | Database | Redis | Twilio sender | Purpose |
|---|---|---|---|---|
| Development | Neon (Postgres, free tier) | Upstash (Redis, free tier) | Sandbox | Local iteration |
| Staging | Render Postgres (separate instance) | Render Key Value (separate instance) | Dedicated staging sender (never the production number) | Pre-release verification, safe template testing, Phases 1–8 |
| Production | Render Postgres (separate instance, backups on) | Render Key Value (separate instance) | Production business number | Real customers, Phase 8a onward only |

Each environment gets its own `.env` and its own Twilio credentials. **No environment shares a secret, a database, or a Twilio sender with another** — this is a `CLAUDE.md`/`SECURITY.md` rule, not a nice-to-have, and it's much easier to get right from the start than to retrofit later.

## 4. Secrets & credentials checklist

Every one of these needs to exist, in the right environment's secret store, before Phase 1:

- [ ] `TWILIO_ACCOUNT_SID`
- [ ] `TWILIO_AUTH_TOKEN` (used for both sending and webhook signature validation)
- [ ] `TWILIO_WHATSAPP_NUMBER`
- [ ] `DATABASE_URL`
- [ ] `REDIS_URL`
- [ ] `JWT_SIGNING_SECRET` (long, random, generated — not a memorable phrase)
- [ ] `SENTRY_DSN` (or equivalent error tracker)
- [ ] Object storage credentials (only if receipt image storage is in scope — see §2)

Production secrets go in the hosting platform's secret manager, never in a `.env` file sitting on a server disk. `.env.example` in the repo lists every key above with no values — this is what Phase 0's scaffolding prompt will create.

## 5. Tooling & repo setup

- [ ] Node LTS installed, version pinned (`.nvmrc` or `engines` field)
- [ ] GitHub (or equivalent) repo created, with **branch protection on `main`**: no direct pushes, PR required, CI must pass, at least one human approval required before merge — this last one is not optional, per `CLAUDE.md`'s human-review rule
- [ ] The full doc set (`CLAUDE.md`, `docs/PRD.md`, `docs/TRD.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE_SCHEMA.md`, `docs/USER_JOURNEY.md`, `docs/SECURITY.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/BUILD_SCRIPT.md`, `docs/BUILD_LOG.md`) and `prisma/schema.prisma` committed to the repo **before** the Phase 0 prompt is given to Claude Code — it reads these, they need to exist first
- [ ] CI provider connected (GitHub Actions or equivalent) — the actual workflow file gets created in Phase 0, but the provider/account should be ready
- [ ] Error tracker (Sentry or equivalent) project created, DSN captured
- [ ] Uptime monitor (even free-tier — UptimeRobot, Better Stack) ready to point at `/health` once it exists

## 6. Third-party service setup

- [ ] Retool workspace created, connected to a **staging** Admin API resource first — do not point Retool at production until Phase 5 is verified and merged on staging
- [ ] Whoever will operate Retool day-to-day (the COO) has an account and basic familiarity with the tool — don't leave this until Phase 5 is done and then discover the learning curve is the actual blocker

## 7. Pre-Phase-0 sign-off

Say each of these out loud to whoever's supervising the build — literally confirm it, don't just assume it:

- [ ] Meta/Twilio WhatsApp Business Profile submission is **in progress** (longest lead time in the whole project — must not be the thing blocking launch at the end)
- [ ] Every environment (dev/staging/prod) has its own isolated database, Redis instance, and Twilio credentials
- [ ] No secret exists anywhere in the repo, in Slack, or in a shared doc in plaintext — only in each environment's secret manager
- [ ] Branch protection is on, requiring both green CI and a human approval before merge
- [ ] A named person (not Claude Code) will personally review Phases 1, 3, 5, and 7 per `CLAUDE.md` — confirmed available, not just "we'll find someone"
- [ ] Everyone involved has read `docs/PRD.md` and agrees it correctly describes the business rules — this is the last cheap point to catch a wrong assumption, before it's built into message copy and pricing logic

Once every box above is checked, hand the Phase 0 prompt from `docs/BUILD_SCRIPT.md` to Claude Code.
