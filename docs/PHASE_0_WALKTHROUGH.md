# Woshmart — Phase 0 Walkthrough

A click-by-click companion to the Phase 0 checklist in `BUILD_SCRIPT.md`. Do these in order — items 1 and 2 have the longest lead times, so they're first on purpose. Everything here is a *human* task; Claude Code's part (repo scaffolding) only starts once this whole document is checked off.

Interfaces change over time — if a screen doesn't match exactly what's described, the underlying step (the button's *purpose*) is still accurate; look for the equivalent control.

---

## 1. Twilio account + WhatsApp Sandbox

**Goal:** send a WhatsApp message from your phone and see it land in Twilio.

1. Go to **twilio.com** and sign up (or log in if the business already has an account).
2. Verify your email and phone number when prompted — Twilio requires both before the console unlocks fully.
3. Once in the Console, find your **Account SID** and **Auth Token** on the Console home/dashboard. Copy both somewhere safe for now (they go into `.env` later, in §6 — never commit them to the repo).
4. In the left sidebar, go to **Messaging → Try it out → Send a WhatsApp message** (sometimes labeled "Try WhatsApp"). This opens the Sandbox activation screen.
5. Acknowledge the terms and click **Confirm** to activate your Sandbox.
6. You'll see a **Sandbox number** (a shared Twilio number, typically starting `+1 415...`) and a **join code** (a two-word phrase, e.g. `join happy-tiger`).
7. On your own phone, open WhatsApp and either:
   - Scan the QR code shown on the Sandbox screen, **or**
   - Manually send the message `join <your code>` to the Sandbox number.
8. You should get a confirmation reply in WhatsApp within a few seconds. You're now joined to your Sandbox for the next 3 days (rejoin any time after with the same join message — there's no limit on how many times you can rejoin).

**Test it manually (this is the actual exit criterion):**
9. Send any message (e.g. "hi") from your phone to the Sandbox number.
10. In the Twilio Console, go to **Monitor → Logs → Messaging** (or the Sandbox's own "Try it out" screen, which shows recent activity). Confirm your message appears there with its content and timestamp.

☑ Done when: a message sent from your phone is visible in the Twilio Console.

> Note: the Sandbox has no message limit and no time limit on Sandbox usage itself, but the *3-day join* expires and needs rejoining. This is completely fine for all of Phases 0–7 — production numbers only matter at Phase 8.

---

## 2. Meta Business Manager + WhatsApp Business Profile submission

**Goal:** get the actual production WhatsApp number into Meta's approval queue. **Start this today — it's the longest lead time in the whole project (typically 1–3 business days, sometimes longer if business verification is required).**

This no longer requires manually creating a separate Meta Business Manager account first — Twilio's registration flow creates or links one for you in the same process.

1. Decide on the **dedicated business phone number** first (per `SETUP_GUIDE.md` §1 — not a personal line). Have it ready to receive an SMS or call for verification.
2. In the Twilio Console, go to **Messaging → Senders → WhatsApp Senders**.
3. Click **New WhatsApp Sender**.
4. Under "Select a phone number to register," choose the dedicated business number (this can be a Twilio-purchased number or your own number ported in — check current Twilio pricing/options for which fits).
5. Click **Continue with Facebook**. A Meta pop-up window opens — **keep both this pop-up and the Twilio Console tab open**, and do the whole flow in the same browser (switching browsers mid-flow breaks the handoff between Meta and Twilio).
6. Sign in with a Facebook profile that has **Admin access** to the business's Meta Business Manager. If one doesn't exist yet, the flow lets you create one here.
7. Approve the permissions Twilio requests (it needs these to manage WhatsApp messaging on your behalf).
8. Choose an existing WhatsApp Business Account (WABA) or create a new one.
9. Fill in **Business Information**: business name, email, website, country. Use the Woshmart legal/registered business name here — this should match what's used elsewhere (see `PRD.md` §1.1) so Meta's review doesn't flag a mismatch.
10. Set the **Display Name** — this is what customers see. It must match or clearly relate to the registered business name; Meta has its own display name rules (no generic terms, no obvious mismatches with the business), so keep it exactly "Woshmart" or a close variant, not a slogan.
11. Submit.

12. **Business verification** (recommended, not always strictly required to start, but needed to lift messaging limits beyond the low starting tier): in Meta Business Manager, go to **Business Settings → Security Center → Business Verification** and complete it if prompted. This can add its own review time on top of the sender approval — factor that in.

**While waiting for approval:**
- Continue building against the Sandbox — nothing in Phases 0–7 needs the production number.
- Check status periodically in **Messaging → Senders → WhatsApp Senders** in the Twilio Console — the sender's status will move from pending to online once approved.

☑ Done when: the WhatsApp Sender submission is in and showing a pending/in-review status in the Twilio Console (you don't need approval to move on to the rest of Phase 0 — you need the *submission in*).

---

## 3. Postgres provisioned (dev)

Using **Neon** (free tier, no local install needed — good if Docker gives you trouble):

1. Go to **neon.tech** and sign up.
2. Click **Create a project**. Name it something like `woshmart-dev`.
3. Neon provisions a database automatically and shows you a **connection string** on the project dashboard — something like:
   ```
   postgresql://<user>:<password>@<host>.neon.tech/woshmart_dev?sslmode=require
   ```
4. Copy that as your dev `DATABASE_URL`.
5. Confirm it works: paste the connection string into any Postgres client (e.g. `psql "<connection string>"`, or a GUI like TablePlus/DBeaver) and confirm you can connect.

☑ Done when: you can connect to the Neon database using the connection string.

> **Heads up:** free-tier Neon projects can go idle and "sleep" after a period of inactivity — the first query after a break may take a second or two longer while it wakes up. Normal, not a bug, and irrelevant once you're actively developing against it.

<details>
<summary>Alternative: local Docker (if you'd rather not depend on network access for dev)</summary>

1. Install Docker Desktop.
2. Run:
   ```
   docker run --name woshmart-postgres-dev -e POSTGRES_PASSWORD=devpassword -e POSTGRES_DB=woshmart_dev -p 5432:5432 -d postgres:16
   ```
3. Dev `DATABASE_URL`: `postgresql://postgres:devpassword@localhost:5432/woshmart_dev`
4. Confirm with `docker ps`.
</details>

---

## 4. Redis provisioned (dev)

Pairs naturally with Neon — using **Upstash** (also free tier, no local install):

1. Go to **upstash.com** and sign up.
2. Create a new **Redis database**. Name it `woshmart-dev`.
3. On the database's dashboard, copy the provided connection string (`REDIS_URL` or "Redis Connect" string, depending on how Upstash labels it at the time).
4. Confirm it works: most Redis clients (or a quick script using the `redis` npm package) can connect with that URL and run a `PING` — you should get `PONG` back.

☑ Done when: you can connect to the Upstash Redis instance and get a successful `PING`.

<details>
<summary>Alternative: local Docker</summary>

1. Run:
   ```
   docker run --name woshmart-redis-dev -p 6379:6379 -d redis:7
   ```
2. Dev `REDIS_URL`: `redis://localhost:6379`
3. Confirm with `docker ps`.
</details>

> **Staging and production Postgres/Redis run on Render** (the same platform as the backend itself — see `SETUP_GUIDE.md` §2), not Neon/Upstash. Keeping them on Render gives lower latency via Render's private network and one dashboard for backend + database + Redis together. In the Render Dashboard: click **New → Postgres** for a database, or **New → Key Value** for Redis (Render's current name for its Redis-compatible offering). Give it a name (e.g. `woshmart-staging-db`), choose the **same region** as your backend Web Service — this matters, since same-region same-account resources can talk over Render's private network instead of the public internet — and select the **Free** instance type to start (upgrade before Phase 8, since free-tier instances have limitations not suitable for real customer traffic). Once created, open the instance's page and click **Connect** in the top-right to get its **Internal Database URL** (for your Render-hosted backend to use) and **External Database URL** (for connecting from your own laptop if needed, e.g. to inspect data). Use the Internal URL as `DATABASE_URL`/`REDIS_URL` in the backend service's environment variables. Do this once for staging now if you want it ready ahead of time; production's instances get provisioned right before Phase 8, per the environment-isolation rule.

---

## 5. Repo initialized with the folder structure from `ARCHITECTURE.md` §4

The actual folder scaffolding is Claude Code's job in the Phase 0 prompt — but the repo itself, and its protection rules, are a human step first.

1. Create a new **private** GitHub repository (e.g. `woshmart-backend`).
2. Add all the doc set files to the repo root/`docs` folder now, before anything else — `CLAUDE.md` at root, everything else under `/docs`, and `prisma/schema.prisma` at `/prisma` — exactly as laid out in the file tree from earlier. Commit this as the first commit.
3. Set the default branch to `main`.
4. Go to **Settings → Branches → Add branch protection rule** (or "Add rule" depending on GitHub's current UI).
   - Branch name pattern: `main`
   - Enable **Require a pull request before merging**
   - Enable **Require approvals** — set to at least 1
   - Enable **Require status checks to pass before merging** (you'll select the actual CI check once Phase 0's workflow file exists — come back and tick the specific check after that PR)
   - Enable **Do not allow bypassing the above settings** (so even repo admins can't skip it)
   - Save.
5. Add collaborators (your second technical reviewer from `SETUP_GUIDE.md` §0) with write access.

☑ Done when: `main` is protected, requires a PR + approval + passing CI, and the doc set is committed.

---

## 6. `.env.example` committed — every required variable name, no values

This file itself gets created by Claude Code as part of the Phase 0 prompt, but here's the checklist to verify against once it's opened as a PR — every name below should appear, with **no real values**:

```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_NUMBER=
DATABASE_URL=
REDIS_URL=
JWT_SIGNING_SECRET=
SENTRY_DSN=
```

Plus object storage credentials only if receipt image storage is in scope (see `SETUP_GUIDE.md` §2).

☑ Done when: you've reviewed the PR that adds this file and confirmed no real secret value snuck in anywhere.

---

## 7. Staging Twilio sender requested/configured (separate from production)

For an MVP at this scale, you have two reasonable options — pick one deliberately rather than defaulting by accident:

**Option A (simplest, recommended to start): use the Sandbox itself as staging.**
The Sandbox from §1 already is a fully separate, non-production number. Point your staging environment's webhook at it. This costs nothing extra and requires no additional Meta approval. The only limitation: Sandbox sessions need periodic rejoining (§1) and you can only message numbers that have joined — completely fine for internal staging testing.

**Option B: register a second, dedicated staging WhatsApp sender.**
Repeat the full flow in §2 with a second phone number, purely for staging. More realistic (behaves exactly like production), but costs a second number and goes through Meta approval again. Only worth it if you specifically need to test template-message behavior or production-like throughput before going live.

Either way, the requirement that matters is: **staging never shares a number, credentials, or database with production** (`SETUP_GUIDE.md` §3). Document which option you chose in `docs/BUILD_LOG.md`'s notes for Phase 0 so it's not ambiguous later.

☑ Done when: staging's `TWILIO_WHATSAPP_NUMBER` is confirmed different from whatever production will use, and it's written down which option was chosen.

---

## Final check before handing Claude Code the Phase 0 prompt

- [ ] §1–7 above all checked off
- [ ] The full doc set and `prisma/schema.prisma` are committed to the repo
- [ ] Branch protection is live on `main`
- [ ] You (or your reviewer) know where to find the Twilio Account SID/Auth Token and dev `DATABASE_URL`/`REDIS_URL` when Claude Code asks for them to populate the real (non-example) `.env`

Once every box here and in `SETUP_GUIDE.md` §7 is checked, hand Claude Code the Phase 0 prompt from `BUILD_SCRIPT.md`.
