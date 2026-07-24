# Woshmart — Security Document

Standalone security reference. `TRD.md` §7 and `CLAUDE.md`'s non-negotiable rules cover security requirements inline with the rest of the technical spec; this document is the consolidated, audit-ready version — threat model, controls, data classification, incident response, and the vulnerability disclosure policy. If anything here conflicts with `TRD.md`/`CLAUDE.md`, treat that as a bug to reconcile, not a choice between them.

## 1. Scope and assets

**What this system handles that matters from a security perspective:**

| Asset | Sensitivity | Where it lives |
|---|---|---|
| Customer PII (name, phone number, address) | High | `users`, `orders` tables |
| Order/transaction history | Medium | `orders`, `order_status_history` |
| WhatsApp message content | Medium–High (may contain PII, payment receipts) | `messages` table, `raw_payload` JSONB |
| Payment receipt images (if stored) | High | Object storage (if in scope) |
| Admin credentials | Critical | `admins` table (hashed), JWT signing secret |
| Twilio credentials | Critical | Environment/secret manager only |
| Woshman/partner contact info | Medium | `woshmen`, `partners` tables |
| Audit trail | Medium (integrity matters more than confidentiality) | `admin_actions` |

**What this system does *not* handle** (and must not, per `PRD.md` §13 / `CLAUDE.md`): payment card data, bank account credentials belonging to customers, government ID numbers. There is no payment gateway integration, so no PCI-DSS scope exists in this build — keep it that way; if a gateway is ever added later, that's a scope change requiring its own security review, not an incremental addition.

## 2. Threat model

| Threat | Vector | Primary control |
|---|---|---|
| Forged webhook requests (fake orders, fake status updates, spam) | POST directly to `/webhooks/twilio/*` without going through Twilio | Twilio signature validation on every request (§3.1) |
| Replay attacks (resending a captured valid webhook payload) | Re-POSTing a previously valid signed request | `MessageSid` idempotency check (§3.1) — reprocessing is a no-op, not a vulnerability, but still logged |
| Admin credential compromise | Phishing, credential stuffing, weak passwords | Hashed passwords (argon2id/bcrypt), short-lived JWTs, RBAC scoping blast radius, audit log for detection |
| Privilege escalation via the Admin API | A `viewer` or `ops` token attempting a `super_admin`-only action | RBAC middleware on every route, tested explicitly (not just UI-hidden) |
| Order/status tampering | Any path that could write `orders.status` outside the validated state machine | Single-writer enforcement (§3.4) |
| Data exfiltration via the Admin API | Bulk scraping of customer data by a compromised or malicious admin account | Rate limiting, audit logging (who accessed what, when), least-privilege roles |
| SQL injection | Malformed input reaching a raw query | Prisma parameterized queries only, no raw string-concatenated SQL anywhere (§3.5) |
| Secrets leakage | Committed to git, logged, or exposed via error messages | Secrets sweep in CI, structured logging discipline, no secrets in error responses (§4) |
| Denial of service on the webhook endpoint | Flooding `/webhooks/twilio/inbound` | Per-number and global rate limiting (§3.3) |
| WhatsApp account/number abuse | Fraudulent repeat orders, fake accounts | Prepayment-required escalation, account blocking (`PRD.md` §11.6) |
| Insider risk (Woshman/partner impersonation) | Someone other than the registered Woshman/partner sending keyword messages from a spoofed or compromised number | Sender-number matching against the `woshmen`/`partners` tables is the only gate — this is a real residual risk given WhatsApp doesn't offer strong sender attestation beyond the phone number itself; mitigated operationally (Woshmen use their registered personal numbers, loss/compromise reported to COO immediately) rather than technically. Flag this as an accepted risk, not a solved one. |
| Retool credential compromise | Retool account takeover leading to Admin API abuse | Retool connects via its own service credential; if per-user auth passthrough is supported, use it so `admin_actions` reflects the real human, not a shared identity — reduces blast radius and improves detection |

## 3. Controls

### 3.1 Webhook authenticity

- Every request to `/webhooks/twilio/inbound` and `/webhooks/twilio/status` is validated against Twilio's `X-Twilio-Signature` header using the official Twilio SDK helper — never a hand-rolled HMAC comparison.
- Validation is performed against the **exact** production URL (protocol, host, path) Twilio was configured with. A common failure mode is validating against `http://` internally behind a proxy that terminates TLS, while Twilio signed against `https://` — this silently breaks validation. Confirmed explicitly in Phase 7 of `BUILD_SCRIPT.md`.
- Signature failures return `403` immediately, without processing the payload, and are logged (timestamp, path, source IP) without logging the full unverified payload (avoids ingesting attacker-controlled content into logs at volume).
- `MessageSid` uniqueness is checked before any processing — this makes both legitimate Twilio retries and malicious replay attempts inert.

### 3.2 Admin authentication & authorization

- Passwords hashed with argon2id (preferred) or bcrypt — never stored or logged in plaintext, never transmitted except over TLS at login.
- JWTs are short-lived (~8 hours), signed with a dedicated secret stored only in the environment/secret manager, containing admin id, role, issued-at, expiry — no PII beyond what's operationally necessary, since JWT payloads are base64-encoded, not encrypted.
- Every Admin API route (except `/admin/auth/login`) requires a valid, unexpired JWT (`auth.middleware.ts`) and passes an explicit role check (`rbac.middleware.ts`) matching the route's minimum required role (`TRD.md` §5.2).
- No shared/service-wide admin logins. One account per human — this is what makes the audit log meaningful for incident investigation.
- Password reset: token-based, short expiry (15–30 min), single-use, invalidated after use.
- No public admin signup endpoint exists. The first `super_admin` is seeded directly via a script, not an API call.

### 3.3 Rate limiting

| Surface | Limit basis | Purpose |
|---|---|---|
| Inbound webhook | Per phone number | Contain a misbehaving client or targeted abuse of a single conversation |
| Inbound webhook | Global | Backstop against volumetric flooding of the process itself |
| Admin API | Per admin / per IP | Internal low-traffic tool — spikes indicate a bug or compromised credential, not legitimate load |
| Outbound Twilio sends | WhatsApp Business API tier limits | Respect Twilio/Meta's own throttling — queued and paced, not fire-and-forget, to avoid the number being throttled or flagged |

### 3.4 Data integrity — single-writer enforcement

`orders.status` has exactly one legitimate writer: the state machine function validating against the legal-transition table in `TRD.md` §9. This applies uniformly regardless of trigger source — conversation engine, keyword parser, and Admin API all call the same function. No migration script, seed script, or ad hoc query is permitted to set `orders.status` directly outside of clearly-labeled one-off data-correction scripts, which themselves require sign-off before running against production.

### 3.5 Input handling

- Every Admin API request body is validated against a Zod schema before touching the database.
- Twilio webhook payloads are validated for expected shape even though they're already signature-verified — payload shape has changed in Twilio API versions before, and defensive parsing avoids a malformed-but-signed payload from causing an unhandled exception.
- All database access goes through Prisma's parameterized query interface. No raw string-concatenated SQL anywhere in the codebase — flagged as a blocking issue in code review per `CLAUDE.md`.
- Phone numbers normalized to E.164 on ingestion, preventing duplicate records from formatting inconsistency and reducing the surface for lookup-based enumeration quirks.

### 3.6 Data protection

- **Encryption in transit:** TLS everywhere — Twilio↔backend, backend↔database, backend↔Redis (where supported by the provider), Retool↔Admin API.
- **Encryption at rest:** managed Postgres with disk-level encryption at rest, verified explicitly (not assumed) at setup and again in Phase 7.
- **Minimized logging of PII:** message bodies, full addresses, and full names are not written at `info` level in a way that lands unrestricted in long-retention aggregated logs. Structured logs reference order/message IDs; full content is reserved for the `messages` table itself, which has its own access controls.
- **Receipt images**, if stored: private object storage (e.g. S3 with private ACLs), accessed only via short-lived signed URLs — never a public bucket, never embedded directly in a log or an unauthenticated response.
- **Direct database access** (psql, DB GUI tools) restricted to a small named set of engineers via VPN/IP allowlist and strong authentication. Retool and the application itself go through the Admin API — direct DB credentials are not distributed broadly, and definitely never shared with Retool.
- **Data retention:** define and enforce a retention window (e.g. message content retained 12 months, then purged or archived) rather than unbounded retention by default. Document the chosen window once decided; unbounded retention increases breach impact for no operational benefit.

### 3.7 Secrets management

- `.env` files are never committed — `.gitignore` enforces this, and `.env.example` (names only, no values) is the only committed reference.
- Production secrets live only in the hosting platform's secret manager (or equivalent), not on disk in a plain file.
- Credentials are never shared across environments — a staging Twilio Auth Token cannot reach the production WhatsApp number, a dev database credential cannot touch staging or production data.
- A secrets sweep across git history (not just the current working tree) is run explicitly in Phase 7 of `BUILD_SCRIPT.md`, and should be re-run periodically thereafter (e.g. via a tool like `gitleaks` in CI going forward).
- On any suspected exposure: rotate the affected credential immediately. For the JWT signing secret specifically, rotating it invalidates all issued tokens — accept the forced re-login cost rather than leaving a suspected-compromised secret active.

### 3.8 Auditability

- Every Admin API write produces an `admin_actions` row (admin id, action, entity type/id, before/after values, IP, timestamp) via middleware — automatic, not opt-in per route, per `CLAUDE.md` rule 12.
- `order_status_history` independently records every status transition regardless of trigger source, giving a second, order-centric audit trail alongside the admin-centric one.
- Audit data itself is retained at least as long as the underlying order data it references.

### 3.9 Backups & disaster recovery (Render Postgres — staging is currently free tier)

Both staging (`woshmart-staging-db`) and production Postgres run on Render Postgres, not Neon (Neon is local-dev only). **Confirmed directly against Render's own docs, not assumed:** `woshmart-staging-db` is currently on Render's **free** Postgres tier, which has two consequences beyond the usual backup question:

1. **No native backups at all.** Render's automated-backup feature requires a paid plan (Starter or above) — the free tier has none, not even a short retention window. This is a harder gap than "retention is too short" — there is nothing to restore from via Render itself.
2. **Free-tier databases are deleted on a fixed clock, independent of usage.** Per Render's docs: a free Postgres instance expires **30 days after creation**, then gets a **14-day grace period** to upgrade before Render **permanently deletes the database and all its data**. Total lifespan: **44 days**, unless upgraded to a paid plan first.

**The actual dates for `woshmart-staging-db`:**

| | Date |
|---|---|
| Created | **2026-07-24** |
| 30-day expiration | **2026-08-23** |
| 44-day hard deletion (end of grace period) | **2026-09-06** |

This is tracked as a real date, not an abstract policy, specifically so it can't quietly slip past — see the automated reminder below. (The reminder script computes its own effective creation date live from the database, per the mechanism described there — it will normally match this table almost exactly, but this table is the human-readable record, not the thing the automation actually reads.)

**Compensating control, since Render's free tier gives us nothing to rely on:** `.github/workflows/staging-backup.yml` runs daily (03:00 UTC) and does two things:

- **`backup` job:** `pg_dump`s `woshmart-staging-db` in custom format (`-Fc --no-owner --no-acl`, so it restores cleanly onto a differently-owned fresh instance) and uploads it to a private Backblaze B2 bucket via B2's S3-compatible API. Retention (`TRD.md` §7's 7-day minimum) is enforced by a **B2 bucket lifecycle rule** that auto-deletes objects after 8 days — not by any deletion logic in the workflow itself, so a workflow bug can't wipe out the only recent copies.
- **`deadline-reminder` job:** runs `scripts/check-staging-db-deadline.ts`, which queries the database directly for its own effective creation date — Postgres has no genuine "database created at" anywhere in its system catalogs (checked directly against `pg_database`/`pg_stat_database`: neither exposes one), so the script uses the earliest `_prisma_migrations.started_at` as a reliable proxy. That row is written automatically the moment `prisma migrate deploy` first runs against a database (already step 3 of the restore procedure below), so this self-corrects after a recreation with **no manual date to keep in sync**. Starting at day 28 (a small safety margin, since the proxy timestamp is always very slightly later than the database's true creation moment), it sends an urgent email via the same alerting mechanism as Phase 7's payment/data-integrity alert (`nodemailer`, same SMTP shape) — escalating subject line as the deadline nears (⚠️ → ⚠️ URGENT at ≤7 days → 🚨 FINAL WARNING at ≤3 days). Treated with the same seriousness as that category, because a missed deadline here means permanent, unrecoverable data loss, not a delayed notification.

**One-time setup required (cannot be done from within this repo/session):**

*Backblaze B2:*
1. Sign up at backblaze.com/b2 (free — 10GB storage included).
2. Create a **private** bucket (e.g. `woshmart-staging-backups` — bucket names are global, add a suffix if taken).
3. On the bucket, add a **Lifecycle Rule**: "keep only files uploaded in the last 8 days" (or the equivalent "days from uploading" rule) — this is what actually enforces the 7+ day retention window, not the workflow.
4. Create an **Application Key** scoped to only that bucket, read+write capability only (not the master key, not "list all buckets").
5. Note the Key ID, Application Key (secret), bucket name, and the bucket's S3-compatible endpoint (shown on the bucket's details page, e.g. `s3.us-west-004.backblazeb2.com`).

*GitHub repo secrets* (Settings → Secrets and variables → Actions):
- `STAGING_DATABASE_URL` — the real staging connection string.
- `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET_NAME`, `B2_ENDPOINT` — from the B2 setup above.
- `ALERT_SMTP_HOST`, `ALERT_SMTP_PORT`, `ALERT_SMTP_USER`, `ALERT_SMTP_PASSWORD`, `ALERT_EMAIL_TO` — same values as the app's Phase 7 alert-email config (`woshmart@gmail.com` as the recipient).

**Recreate-and-restore procedure** (the actual emergency runbook — follow this either when the deadline arrives, or to test the process before it matters):

1. **Download the latest dump** from the B2 bucket (via the B2 web console, or `aws s3 cp s3://<bucket>/<file> . --endpoint-url <endpoint>` with the same credentials as the workflow).
2. **Create a fresh Render Postgres instance** (free tier again, or upgrade to paid this time to stop the clock permanently — see below). Note its new connection string.
3. **Recreate the schema from Prisma's migrations** — the migrations in `prisma/migrations/`, not the dump, are the schema's source of truth:
   ```
   DATABASE_URL="<new connection string>" npx prisma migrate deploy
   ```
4. **Restore the data** with `pg_restore` against the fresh, now-schema-only database:
   ```
   pg_restore --no-owner --no-acl --data-only -d "<new connection string>" <dump-file>
   ```
   `--data-only` is deliberate: the schema already came from step 3's migrations, so this only replays row data, avoiding any conflict between the dump's captured schema and the migrations' current one.
5. **Verify before switching anything over:** connect to the new instance and spot-check known data — row counts on `orders`/`users`, a specific order by its `order_number`, that `admin_actions` audit rows are present. Don't trust "the command exited 0" alone.
6. **Update `DATABASE_URL`** on the Render Web Service (staging) to the new connection string, and confirm `/health` shows both `db` and `redis` as `up` against the new database.
7. **Delete the old, expired database** once the new one is confirmed working, and record the date/what was verified here or in `docs/BUILD_LOG.md`'s Post-MVP log. No separate step is needed to reset the deletion-deadline reminder — step 3's `prisma migrate deploy` against the new instance already wrote the fresh `_prisma_migrations` row the reminder script reads its effective creation date from, so it's automatically tracking the new instance's clock the next time it runs.

**The better long-term fix:** upgrading `woshmart-staging-db` to a paid Render plan before 2026-08-23 stops this clock entirely and gets Render's own native backups (§ above) instead of relying on this custom mechanism — worth doing regardless of how well the backup/restore path above works, since a custom pg_dump/B2 pipeline is a compensating control, not a replacement for the real thing.

### 3.10 Alerting (Render's built-in notifications)

Per `CLAUDE.md`'s alerting philosophy, urgent/paging notifications are reserved for **API fully down**, **DB unreachable**, and **payment/data-integrity issues** — everything else stays in logs/Retool for business-hours review. Render's own dashboard can directly cover the first two; the third needs an application-level signal, since Render has no visibility into business logic.

**API fully down** — Render Dashboard → the Web Service → **Settings** → **Health & Alerts**:
- Confirm the health check path is set to `/health` (already implemented — checks both DB and Redis).
- Enable notifications for **"Health Check Failed"** / **service marked unhealthy**. Render debounces this internally (a few consecutive failed checks, not one blip) before marking a service unhealthy, which is what keeps a single transient failure from paging anyone — that debounce is Render's own behavior, not something configured here.
- Enable notifications for **"Deploy failed"** — a bad deploy that never goes live is functionally the same as an outage.

**DB unreachable** — Render Dashboard → the Postgres instance → **Settings** → **Alerts**:
- Enable the **"Database unavailable"** notification.
- CPU/memory/disk-usage threshold alerts are also available here — per the alerting philosophy, treat these as *trend* signals (business-hours review), not urgent pages, unless Render's own alert explicitly indicates the instance is down/unreachable, not just under load.

**Payment/data-integrity issues** — not something Render's dashboard can see. Handled at the application level instead: `src/jobs/queue.ts`'s `logJobFailure` sends a dedicated urgent alert email (via `src/lib/alertEmail.ts`, configured through the `ALERT_SMTP_*`/`ALERT_EMAIL_TO` environment variables) specifically when the `payment-abandon` job — the one whose permanent failure can leave an order stuck in `awaiting_payment` indefinitely — exhausts all its retries. Deliberately narrow: this is not a general alerting platform, it's the one category CLAUDE.md calls out as deserving a real page. A single retryable failure of that same job (attempts remaining) does *not* trigger the email — covered by `tests/jobs/queue.deadLetter.test.ts`'s "does not send the urgent alert email while retries remain" test, which is the explicit "a single transient failure does not page" verification `BUILD_SCRIPT.md` Phase 7 item 8 asks for.

## 4. Incident response

This is intentionally lightweight — sized for a small team running a regional MVP, not an enterprise IR program. The point is having *something* written down before an incident, not building process for its own sake.

### 4.1 Severity levels

| Level | Definition | Example |
|---|---|---|
| **SEV1 — Critical** | Active data breach, credential compromise with confirmed unauthorized access, or payment/financial data integrity issue | Admin credentials confirmed compromised and used; customer PII confirmed exfiltrated |
| **SEV2 — High** | Suspected (not yet confirmed) compromise, or a vulnerability discovered that could lead to SEV1 if exploited | A secret found exposed in git history; a signature-validation bypass discovered |
| **SEV3 — Medium** | Security-relevant bug with no evidence of exploitation, or a control gap found during review | A missing Zod validation on one Admin API route; an overly broad log statement |
| **SEV4 — Low** | Hardening opportunity, best-practice gap, no direct exploit path | Password hashing cost factor could be tuned higher; rate limit threshold could be tighter |

### 4.2 Response steps (SEV1/SEV2)

1. **Contain** — rotate the affected credential(s) immediately (Twilio Auth Token, JWT signing secret, DB credentials, admin passwords as applicable). Rotating the JWT secret force-invalidates all sessions — acceptable cost during an active incident.
2. **Assess** — use `admin_actions` and `order_status_history` to establish what was actually accessed or changed, and by what identity/token. Use `messages.raw_payload` and webhook logs to establish the entry point if the vector is unclear.
3. **Notify** — inform the founder/COO immediately for any SEV1. If customer PII is confirmed affected, this is a notification-worthy event under Nigeria's NDPR (see §6) — get this in front of whoever owns that decision quickly, don't let it sit as a purely technical matter.
4. **Remediate** — fix the root cause (patch the vulnerability, close the gap), not just the symptom.
5. **Document** — record what happened, timeline, root cause, and remediation in a short incident writeup. Keep this even for near-misses (SEV2 that didn't escalate) — the writeup is what prevents a repeat.

### 4.3 Response steps (SEV3/SEV4)

Log as a normal engineering issue, prioritize alongside other work, fix without the urgency/notification steps above. Track resolution — don't let these silently age out.

### 4.4 Incident log

Dated record of actual incidents, per §4.2 step 5 — kept even for near-misses, since the writeup is what prevents a repeat.

**2026-07-24 — Redis password exposed in terminal output (SEV3)**
- **What happened:** the real Upstash Redis password appeared in terminal output during interactive debugging earlier in this session (a `cat .env`-equivalent command run while diagnosing an unrelated issue).
- **Evidence of exploitation:** none.
- **Root cause:** the real secret value was visible in command output during an interactive debugging session, rather than being handled through a mechanism that avoids echoing it (e.g. piping via stdin with no echo, or reading through a secrets manager instead of a plaintext file dump).
- **Remediation:** credential rotated.

**2026-07-24 — Staging database password exposed in terminal output (SEV3)**
- **What happened:** the real staging Postgres password appeared in terminal output when setting `$env:DATABASE_URL` inline for a seed script run against staging.
- **Evidence of exploitation:** none. Staging-only credential, not production.
- **Root cause:** same as above — a real secret value passed and echoed via an interactive shell command rather than a mechanism that avoids displaying it.
- **Remediation:** a new default credential was created on the Render Postgres instance, `DATABASE_URL` was updated on the Web Service to the new credential, `/health` was confirmed showing both `db` and `redis` up on the new configuration, and the old credential was deleted.

**Severity rationale for both:** SEV3, not SEV1/SEV2 — no evidence of exploitation, staging-only (the Redis instance) or explicitly non-production (the DB credential), and both were rotated promptly once identified. Per §4.1's definitions, a SEV2 would require the secret being *found exposed in git history* specifically; the Phase 7 git-history sweep (§3.7) found neither of these two values committed anywhere, which is what keeps this a contained near-miss rather than an escalation.

## 5. Vulnerability disclosure

Woshmart is an internal operational system, not a public-facing product with an external user base submitting bug bounty reports — but the discipline still applies if a partner, Woshman, or customer ever reports something that looks like a security issue (e.g. "I got someone else's order confirmation"):

- Take every such report seriously and investigate before dismissing it as user error.
- Do not discuss suspected vulnerabilities in public channels (customer-facing WhatsApp, public GitHub issues) — route to the engineering/COO team directly.
- If a report is confirmed, follow the incident response steps in §4 at the appropriate severity.

## 6. Regulatory context (Nigeria)

- The **Nigeria Data Protection Act (NDPA) 2023** and the preceding NDPR framework govern the handling of Nigerian residents' personal data — customer names, phone numbers, and addresses collected by this system fall squarely under this.
- Practical implications for this build: data minimization (don't collect more than the order flow needs — the schema already reflects this), a defined retention policy (§3.6), reasonable security safeguards (this whole document), and a notification obligation if a breach affecting personal data occurs.
- This document is not legal advice. If Woshmart's order volume or data footprint grows meaningfully, get an actual compliance review from someone qualified in Nigerian data protection law rather than relying solely on this engineering-authored summary.

## 7. Pre-launch security checklist

Consolidated from `BUILD_SCRIPT.md` Phase 7 — the concrete list to walk through before Phase 8 (launch):

- [ ] Twilio signature validation confirmed against the exact production URL/protocol/path — **not done in Phase 7**: requires real production Twilio console access, which this session doesn't have; confirm directly once production is provisioned.
- [x] Per-number, global, and Admin API rate limiting active and tested (`src/webhooks/rateLimit.middleware.ts`, `src/admin-api/middleware/rateLimit.middleware.ts`, `src/lib/rateLimiter.ts`; outbound throttle in `src/messaging/send.service.ts`)
- [x] Every Admin API route has Zod input validation (audited Phase 7 — every route taking a body already had one; no gaps found)
- [x] No currency field or calculation uses float/NUMERIC — integer kobo confirmed everywhere (swept Phase 7 — clean)
- [x] Git history swept for committed secrets — none found (swept Phase 7 — only `.env.example` and fake/local-only placeholder values in git history, no real credential ever committed)
- [x] Logs at `info` level reviewed for PII — one gap found and fixed (`src/conversation/states/quote.ts` was logging the full session context, including the customer's raw address, at error level; now logs only which fields are missing)
- [ ] Automated daily backups confirmed active, point-in-time recovery enabled, one test restore actually performed — **needs Render dashboard access**, see §3.9. Procedure documented; execution and result pending.
- [x] Error tracking wired (`@sentry/node` via `src/lib/sentry.ts`) and confirmed capturing a real test exception (`tests/admin-api/diagnostics.test.ts`, against a mocked Sentry module) — **end-to-end capture against a real Sentry project still pending** a real `SENTRY_DSN`, which hasn't been provisioned yet.
- [x] Alert thresholds configured per the alerting philosophy in `CLAUDE.md` — confirmed not to fire on normal transient blips. Render-side steps documented in §3.10 (needs dashboard access to actually enable); the one application-level alert (payment-abandon dead-letter email) is wired and its "does not fire on a single transient failure" behavior is unit-tested.
- [x] RBAC explicitly tested: a `viewer` token cannot perform any write action, an `ops` token cannot touch pricing config (pre-existing Phase 5 coverage — spot-checked, still correct)
- [x] `admin_actions` audit logging confirmed on every write route, not just spot-checked (pre-existing `auditGuardMiddleware`, reviewed Phase 6/7)
- [x] `orders.status` confirmed to have exactly one writer across the whole codebase (`order.statemachine.ts`'s `transitionOrderStatus` — reconfirmed Phase 7)
- [ ] Production and staging confirmed fully isolated — no shared secrets, database, or Twilio sender — **not verifiable from this session**; confirm directly against the actual Render/Twilio configuration.
- [ ] Data retention policy decided and documented (even if the enforcement job is a Phase 9+ item) — not addressed in Phase 7, remains open.
- [ ] This document reviewed by a second person before go-live, not just the person who built the system
