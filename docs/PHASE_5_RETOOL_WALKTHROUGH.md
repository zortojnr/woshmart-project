# Woshmart — Phase 5: Render Staging Deploy + Retool Connection Walkthrough

Companion to Phase 5 of `BUILD_SCRIPT.md`. This is the concrete click-by-click record of standing up the staging Admin API on Render and wiring Retool to it — written up so it doesn't need to be reconstructed from memory later, and so the production deploy (Phase 8) can reuse the same steps with different values.

## Part A — Deploy the Admin API to Render staging

### 1. Create the staging Postgres
1. Go to render.com, sign in.
2. **New + → Postgres**.
3. Name it `woshmart-staging-db`. Pick a region — note it, everything else needs to match. Free instance type to start (upgrade before Phase 8, per `SETUP_GUIDE.md`).
4. **Create Database**, wait for it to show "Available."
5. Open the instance → **Connect** (top right). Copy the **Internal Database URL** (for the web service) — keep this tab open, the **External Database URL** is needed later too.

### 2. Create the staging Redis
6. **New + → Key Value** (Render's current name for its Redis-compatible offering). Name it `woshmart-staging-redis`, same region as the DB.
7. Create, then **Connect → copy the Internal Connection String**.

### 3. Create the Web Service
8. **New + → Web Service**.
9. Connect GitHub if not already linked, select the `woshmart-project` repo.
10. **Branch: `main`** — staging tracks merged work only, never a `phase-N-*` branch directly.
11. **Region:** same as the DB/Redis above (required for Render's private network to apply).
12. **Runtime:** Node.
13. **Build Command:** `npm ci && npm run build`
14. **Start Command:** `npx prisma migrate deploy && npm run start` (applies pending migrations on every deploy, then starts — no separate manual migration step).
15. **Instance Type:** Free, to start.
16. Don't click Create yet — environment variables first.

### 4. Environment variables
(Web Service page → **Environment** tab → **Add Environment Variable**, one per row)

| Variable | Value |
|---|---|
| `NODE_ENV` | `staging` |
| `DATABASE_URL` | Internal Postgres URL from step 5 |
| `REDIS_URL` | Internal Redis connection string from step 7 |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_NUMBER` | Staging Twilio sender's credentials — a dedicated staging sender, never the sandbox reused as prod, never prod's own number (`SETUP_GUIDE.md` §1) |
| `JWT_SIGNING_SECRET` | Freshly generated — run `openssl rand -hex 32` locally, paste the output. **Never reuse the dev secret.** |
| `BANK_NAME` / `BANK_ACCOUNT_NUMBER` | Real or a clearly-fake staging placeholder — never the real production account here |

**Do not set `PORT`** — Render injects it automatically and `server.ts` reads `env.PORT`.

17. **Create Web Service.** First deploy takes a few minutes — watch the **Logs** tab.
18. Once live, confirm: visit `https://<your-staging-url>.onrender.com/health` in a browser — expect a JSON body reporting DB/Redis reachable.

### 5. Seed the first staging super_admin

Run from your own machine against the staging DB using the **External** Database URL from step 5 (the seed script only needs `DATABASE_URL`, nothing else):

```
DATABASE_URL="<staging External Database URL>" npx tsx scripts/seed-super-admin.ts coo@woshmart.com "Your COO's Name"
```

It prompts for a password on stdin — type it there, not as a command argument, same reasoning as avoiding secrets in shell history.

19. Confirm login works — **without** putting the password in the command itself or shell history:

    ```bash
    read -s -p "Staging COO password: " COO_PASSWORD
    echo
    jq -n --arg email "coo@woshmart.com" --arg password "$COO_PASSWORD" '{email:$email,password:$password}' \
      | curl -s -X POST https://<your-staging-url>.onrender.com/admin/auth/login \
          -H "Content-Type: application/json" --data-binary @-
    unset COO_PASSWORD
    ```

    - `read -s` disables terminal echo, so the password is never printed or recorded.
    - Only the `read -s -p ...` and `jq`/`curl` *lines* land in shell history — neither contains the literal password, since it's referenced as `$COO_PASSWORD`.
    - Piping the JSON body in via `--data-binary @-` (rather than a `-d "..."` command-line argument) also keeps the password out of the process list (`ps aux`) while `curl` runs.
    - `unset` clears the variable from the shell's environment once done.

    PowerShell equivalent:
    ```powershell
    $pw = Read-Host -AsSecureString "Staging COO password"
    $plainPw = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($pw))
    $body = @{ email = "coo@woshmart.com"; password = $plainPw } | ConvertTo-Json
    Invoke-RestMethod -Method Post -Uri "https://<your-staging-url>.onrender.com/admin/auth/login" -ContentType "application/json" -Body $body
    Remove-Variable plainPw, pw
    ```

    Expect a `200` with a `token` field back.

## Part B — Connect Retool to it

### 6. Create the REST API resource
20. In your Retool workspace → left sidebar puzzle-piece **Resources** icon → **Create New → Resource**.
21. Choose **REST API**.
22. Name: `Woshmart Staging Admin API`.
23. Base URL: `https://<your-staging-url>.onrender.com`.
24. Authentication: leave as **None** at the resource level — this API uses a short-lived JWT from login, handled per-query rather than a static key. **Create Resource**.

### 7. Handle login inside the app (JWT, not a static key)
25. New Retool app → `Woshmart Ops — Staging`.
26. Two Text Input components: `loginEmail`, `loginPassword` (set the second to type Password).
27. A Button `loginButton`.
28. New query on the staging resource: `login`, method **POST**, path `/admin/auth/login`, body:
    ```json
    { "email": {{ loginEmail.value }}, "password": {{ loginPassword.value }} }
    ```
29. `login`'s Event Handlers → **on Success** → Set temporary state value → `authToken` = `{{ login.data.token }}`. Second handler the same way → `currentAdminRole` = `{{ login.data.admin.role }}`.
30. `loginButton`'s onClick → Trigger query → `login`.

> Using Retool's *temporary* state (not Local Storage) for `authToken` means it doesn't persist across page reloads — a deliberate tradeoff: slightly less convenient (re-login on refresh) but avoids a JWT sitting in browser storage longer than it needs to.

### 8. Build the Orders screen
31. Query `listOrders`: GET `/admin/orders`, header `Authorization = Bearer {{ authToken.value }}`.
32. Table component, bind data to `{{ listOrders.data.orders }}`.
33. Query `getOrderDetail`: GET `/admin/orders/{{ ordersTable.selectedRow.data.id }}`, same auth header — triggered on row select, feeds a detail panel/modal.
34. Query `markPaid`: PATCH `/admin/orders/{{ ordersTable.selectedRow.data.id }}/status`, body `{ "status": "paid" }`, same auth header. Wire a "Mark PAID" button to it, re-trigger `listOrders` on success to refresh the table.
35. Query `assignOrder`: PATCH `/admin/orders/{{ ordersTable.selectedRow.data.id }}/assign`, body `{ "woshmanId": {{ woshmanDropdown.value }}, "partnerId": {{ partnerDropdown.value }} }`. Dropdowns bind to `listWoshmen`/`listPartners` queries (below) — filtering to available/active is a nice-to-have, not required for the first pass.

### 9. Users, Woshmen, Partners screens
36. Same pattern each: a `list*` GET query feeding a Table, and an `update*`/`flag*` PATCH query wired to a form or inline edit — all carrying the same `Authorization: Bearer {{ authToken.value }}` header.

### 10. Role-gating (UI convenience only — real enforcement is server-side)
37. On any write button/component (Mark PAID, Assign, Flag, edit forms, the entire Pricing page), set **Visible** to a JS expression:
    ```
    {{ currentAdminRole.value !== 'viewer' }}
    ```
    Pricing-write specifically: `{{ currentAdminRole.value === 'super_admin' }}`.
38. **This is UI convenience only.** Confirm separately (covered by the automated RBAC tests, worth reconfirming manually here too) that hitting the same PATCH endpoints directly with a `viewer` token still returns `403` regardless of what Retool's UI shows or hides.

## Reuse for Phase 8 (production)

Same steps, Part A only needs re-running with:
- New Render Postgres/Key Value instances named for production
- Production Twilio credentials (the real, Meta-approved number)
- A fresh `JWT_SIGNING_SECRET`, distinct from staging's
- The real bank account details, not a placeholder
- A separate Retool resource/app pointed at the production URL — never point the same Retool app at both environments
