# Woshmart — Phase 8: Production Cutover Checklist

Prepared per `BUILD_SCRIPT.md` Phase 8 item 3 — **documented, not executed.** Per CLAUDE.md's manual-production-promotion rule, going live is a deliberate human action; Claude Code has not provisioned any of this. Follow the same click-by-click style as `docs/PHASE_5_RETOOL_WALKTHROUGH.md`, since that's the staging equivalent of most of these steps with different values.

Do not start this until Phase 8's staging E2E walkthrough (`docs/PHASE_8_STAGING_E2E_WALKTHROUGH.md`) has actually passed, and not before Phase 8a's supervised-pilot requirement is understood — this checklist gets you to a working production environment, not to "safe to open to unsupervised customers." That's Phase 8a, after this.

## 1. Production Postgres (Render)

1. Render Dashboard → **New + → Postgres**.
2. Name it `woshmart-production-db`. Same region choice matters for every other production resource below — pick once, reuse everywhere.
3. **Instance type: a paid plan, not free** — this is the one non-negotiable difference from how staging started. Free-tier Postgres has no backups at all and is deleted after 44 days (confirmed the hard way on staging — see `docs/SECURITY.md` §3.9). Production cannot start on that clock.
4. Once available, confirm automated backups are active and point-in-time recovery is enabled (Render Dashboard → the instance → **Backups** tab) — don't just assume the paid plan includes it, check the tab directly.
5. Copy the **Internal Database URL** for the Web Service's env vars (step 3 below), and keep the **External Database URL** available for the one-time migration/seed step.

## 2. Production Redis (Render Key Value)

1. **New + → Key Value**. Name it `woshmart-production-redis`, same region as the DB.
2. Paid tier — BullMQ's job queue (payment timeouts, auto-close, the staging deadline reminder's equivalent doesn't apply here since production presumably isn't on free-tier Postgres, but the queue infra itself still needs a Redis that doesn't randomly evict/reset) needs this to be persistent, not a free tier that could be reclaimed.
3. Copy the **Internal Connection String**.

## 3. Production Web Service (Render)

1. **New + → Web Service**, connect the `woshmart-project` repo.
2. **Branch: `main`** — same rule as staging, production tracks merged work only.
3. **Region:** matching steps 1–2.
4. **Runtime:** Node.
5. **Build Command:** `npm ci --include=dev && npm run build` — the `--include=dev` is required, not optional. `typescript` (and every other build tool: eslint, prettier, vitest, tsx) is a `devDependency`, and with `NODE_ENV=production` set (required below for the app's own runtime behavior), a plain `npm ci` silently skips all of them — `tsc` then doesn't exist, `npm run build` never produces `dist/`, and the service crash-loops on `Cannot find module '.../dist/server.js'` with no indication in the deploy log that this is why. Confirmed empirically: `NODE_ENV=production npm ci` installed 149 packages with `typescript` missing; `NODE_ENV=production npm ci --include=dev` installed the full 289, `typescript` present and correct version. This is a genuine `npm ci` + `NODE_ENV=production` interaction, not a Render-specific quirk.
6. **Start Command:** `npx prisma migrate deploy && npm run start`
7. **Instance type:** paid — free tier's spin-down delay (per `docs/SETUP_GUIDE.md`'s own warning) is not acceptable for real customer traffic waiting on a WhatsApp reply.
8. Environment variables (do **not** click Create until all of these are set):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | leave to Render's default unless you have a reason to override |
| `DATABASE_URL` | Internal Postgres URL from step 1.5 |
| `REDIS_URL` | Internal Redis connection string from step 2.3 |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | The **production** Twilio account's credentials — never staging's, never the sandbox's |
| `TWILIO_WHATSAPP_NUMBER` | The real production business number, once its Meta approval has cleared (see `docs/PHASE_8_LAUNCH_READINESS_SUMMARY.md` — this is the dependency that blocks everything downstream of it) |
| `JWT_SIGNING_SECRET` | **Freshly generated for production specifically** — run `openssl rand -hex 32` locally, paste the output. Never reuse the dev or staging secret; a shared signing secret would mean a staging-issued token could authenticate against production. |
| `BANK_NAME` / `BANK_ACCOUNT_NUMBER` | The real production bank account customers will actually transfer to — not a staging placeholder |
| `SENTRY_DSN` | A **separate Sentry project** from dev/staging if you want production errors distinguishable from test noise — or the same project with environment tagging (Sentry does this automatically via `NODE_ENV`, already wired in `src/lib/sentry.ts`) if you'd rather keep one project. Either is fine; just decide deliberately, don't default into whichever happens to be easiest. |
| `ALERT_SMTP_HOST` / `ALERT_SMTP_PORT` / `ALERT_SMTP_USER` / `ALERT_SMTP_PASSWORD` / `ALERT_EMAIL_TO` | Same alert-email setup as Phase 7 — can reuse the same sending account/recipient, since this is an operational alert, not customer-facing |

9. Create the service. Wait for the first deploy to go green.

## 4. Fresh JWT_SIGNING_SECRET (called out separately since it's easy to skip)

Already listed in step 3's table, but worth its own checklist line because it's the kind of thing that's easy to fat-finger by pasting the wrong environment's value: **confirm** (don't just remember doing it) that production's `JWT_SIGNING_SECRET` is a value that exists nowhere else — not in dev's `.env`, not in staging's Render environment. If in doubt, generate a brand new one now rather than trusting memory of which one you copied.

## 5. Production `super_admin` — seeded directly, not migrated from staging

**Do not** copy the `admins` table (or any row from it) from staging to production — per `BUILD_SCRIPT.md`'s explicit requirement, this is a fresh, separate account.

1. From your local machine, with `DATABASE_URL` temporarily pointed at production's **External Database URL** (from step 1.5):
   ```
   DATABASE_URL="<production external URL>" npx tsx scripts/seed-super-admin.ts <real founder/COO email> "<name>" super_admin
   ```
2. The script prompts for the password via stdin — it's never in shell history, an argv, or a log line. Use a genuinely strong, unique password, not a variation of the staging one.
3. Log in against the production Admin API directly (`POST /admin/auth/login`) to confirm the account actually works before moving on — don't assume the seed succeeded just because the script exited 0.
4. Unset/close the shell session that had `DATABASE_URL` pointed at production, so a later command in that same terminal doesn't accidentally run against it.

## 6. Pricing config — confirmed correct for launch

1. In production Retool (once step 7 below exists) or directly via `GET /admin/pricing` against production, confirm the bundle prices match what's actually intended for launch — `computeQuote()` still reads the static `src/domain/pricing/bundles.config.ts` file, not the `pricing_config` table (that table exists in the schema but has no live wiring yet — a known, already-logged Phase 9+ item, not something to fix in this phase).
2. Since pricing is code-defined, "confirming it's correct for launch" really means: read `bundles.config.ts` as it exists on the `main` branch that's about to be deployed, and have the founder/COO explicitly sign off on those exact numbers before this Web Service goes live — not a database check, a code-and-business-sign-off check.

## 7. Production Twilio sender's webhook URLs

**Do not point these at production until everything above is live and verified.** This is the actual go-live switch.

1. Twilio Console → the production WhatsApp sender → **Webhook configuration**.
2. Inbound message webhook: `https://<production-web-service-url>/webhooks/twilio/inbound`.
3. Status callback webhook: `https://<production-web-service-url>/webhooks/twilio/status`.
4. Confirm the URL's protocol/host/path here is byte-for-byte what `docs/SECURITY.md` §7's pre-launch checklist item ("signature validation confirmed against production Twilio config") is checking against — a mismatch here (e.g. `http://` vs `https://` behind a proxy) is exactly the failure mode that check exists to catch.
5. Send one real WhatsApp message to the production number **after** this is set, and confirm it reaches the production `/health`-confirmed-healthy service and gets a real reply, before telling anyone this number is live.

## 8. Separate production Retool app

1. In Retool, create a **new** app (or new Resource pointing at a new app) — do not repoint the existing staging Retool app at the production API. Per `docs/SETUP_GUIDE.md`/`ARCHITECTURE.md`'s environment-isolation table, staging and production must never share credentials, and that includes which humans have staging-Retool muscle memory accidentally clicking a production action.
2. New Resource: base URL = the production Web Service's URL, auth = the production `super_admin` login from step 5.
3. Rebuild (or duplicate-and-repoint, if Retool's export/import supports it cleanly) the same screens as staging: Orders, Users, Woshmen, Partners, Pricing, Feedback, Messages.
4. Re-verify RBAC live in this new app the same way it was verified on staging in Phase 5 — a `viewer` account should not be able to trigger any write action here either. Don't assume it carries over just because the code is identical; the whole point of a separate app is that nothing is assumed to carry over automatically.

## 9. After all of the above — do not skip to open customer traffic

Once every step above is live and verified, the next required step is **Phase 8a — Supervised pilot** (`BUILD_SCRIPT.md`), not opening the number to the public. Run 3–5 real, human-watched pilot orders first.
