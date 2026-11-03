# Keepers of the Current — v2

Site: https://keepersofthecurrent.org
Stack: Cloudflare Pages + Pages Functions + D1 + Resend
Plan: `~/.claude/plans/flickering-noodling-spindle.md`

## Player access and email operations (November 2026)

- `/lookup.html` uses one-time email links (15-minute lifetime) and secure eight-hour sessions. No exact character-name match is required. Tokens are stored only as hashes.
- Apply migrations `0011_seeker_sign_in.sql` and `0012_email_delivery.sql` before deploying this version. Do not replay applied migrations.
- Confirmations and reminders share the rules in `functions/lib/email.ts`, summarized from `public/trials.html`. Keep these synchronized when trial rules change.
- Registration saves independently of email delivery. `seeker_email_status` and `admin_email_status` track transport results separately; `email_status` remains the legacy aggregate. “Sent” means accepted by Resend, not proof of inbox placement.
- The standalone reminder worker source is `worker/reminder.ts`; deploy with `npx wrangler deploy --config worker/wrangler.toml`. It uses the same D1 database and needs `RESEND_API_KEY`. Its daily cron is 12:00 UTC (6 or 7 AM Central depending on daylight saving).
- Reminders go to active registrations the day before an event starts, include active booked times, and exclude canceled registrations. `reminder_deliveries` records sent/failed results and prevents duplicate sends. Resend idempotency keys protect retries.
- Manual reminder runs require POST `/trigger` plus the configured `REMINDER_TRIGGER_SECRET`. With no secret configured, the endpoint refuses access.
- No automatic Google Calendar synchronization is implemented here. Do not treat Discord RSVPs or trial intentions as booked appointments.
- Test with `npm test`, `npm run typecheck`, and `npx wrangler pages functions build --outdir .wrangler/test-build`. Tests use synthetic data and no real email.

## What's in this folder

| Path | Purpose |
|---|---|
| `public/` | Static site (served by Pages) |
| `public/legacy/v1.html` | The original v1 monolith — fallback through Nov 2026 |
| `functions/` | Pages Functions (the API) |
| `migrations/` | D1 schema + seed data, applied via wrangler |
| `wrangler.toml` | Local dev config (D1 binding, env vars) |
| `.dev.vars.example` | Template for local secrets — copy to `.dev.vars` |

## What's built (Phase 1)

- Seeker intake form at `/seeker.html`
- `POST /api/seekers` — validates, upserts seeker, queues email
- `GET /api/public/events` — feeds the intake dropdown
- Confirmation email to seeker + notification email to desiree.rock@gmail.com
- D1 schema for the full v2 (admin endpoints land in Phase 2)

## What's not built yet

- Admin panel (Phase 2 — needs Cloudflare Access setup)
- Trial tracker, leaderboard, self-lookup (Phase 3)
- Per-page lore content rebuild (Phase 4)

---

## Local setup (one time, ~15 min)

### 1. Node + dependencies

Requires Node 20+. From this folder:

```sh
npm install
```

### 2. Wrangler login

```sh
npx wrangler login
```

Opens a browser for Cloudflare OAuth.

### 3. Create the D1 database

```sh
npx wrangler d1 create keepers-current-db
```

Output ends with a `database_id`. Copy it into `wrangler.toml` (replace `REPLACE_ME_AFTER_WRANGLER_D1_CREATE`).

### 4. Apply migrations locally

```sh
npm run migrate:local
```

Runs all three migrations against a local SQLite shim — schema + seeded events + trial catalog.

### 5. Resend account

1. Sign up at https://resend.com (free tier, no credit card).
2. API Keys → Create API Key → copy.
3. Copy `.dev.vars.example` to `.dev.vars` and paste:

   ```
   RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxx
   ```

   `.dev.vars` is gitignored.

### 6. Run the dev server

```sh
npm run dev
```

Visits:
- http://localhost:8788/ — landing
- http://localhost:8788/seeker.html — intake form
- http://localhost:8788/api/public/events — JSON event list

---

## Phase 1 acceptance test

1. Open `/seeker.html` locally.
2. Submit a real-looking entry to your inbox: name, your email, any house, tick Body, choose Grand Gathering.
3. Expect:
   - Page replaces the form with the success block.
   - Both emails arrive within ~30s (one to your inbox, one to desiree.rock@gmail.com).
   - The DB row is there:

     ```sh
     npm run db:local --command="SELECT * FROM seekers"
     npm run db:local --command="SELECT * FROM registrations"
     ```

If email shows as `failed` in `registrations.email_status` but the row exists → registration succeeded; the email transport is the only thing that broke. Check `wrangler` console output for the Resend error.

---

## Deploy to Cloudflare Pages (production)

### One-time prod setup

1. **Push this folder** to the GitHub repo `KeeperoftheCurrent/keepers-of-the-current` (using your existing upload tool, or `git`).
2. **Cloudflare Pages → project → Settings → Builds & deployments**:
   - Build command: *(leave blank — no build needed)*
   - Build output directory: `public`
3. **Pages → Settings → Functions → D1 database bindings**: add binding name `DB` → database `keepers-current-db`. Add for **both** Production and Preview.
4. **Pages → Settings → Environment variables**:
   - Plaintext (Production + Preview): `KEEPER_NOTIFY_EMAIL=desiree.rock@gmail.com`, `EMAIL_FROM="Keepers of the Current <keeper@keepersofthecurrent.org>"`, `SITE_URL=https://keepersofthecurrent.org`
   - Encrypted (Production + Preview): `RESEND_API_KEY=re_xxx...`
5. **Apply migrations to remote D1**:

   ```sh
   npm run migrate:remote
   ```

### Every deploy after that

Push to GitHub → Pages auto-builds → live within ~60s.

---

## Common one-off commands

### Regression checks

```sh
npm ci
npm run typecheck
npm test
npx wrangler pages functions build --outdir .wrangler/test-build
```

The tests create disposable local D1 databases from the repository migrations,
use synthetic seekers, and stub email delivery. They cover registration rollback,
booking conflicts, award correction/restoration, retired trials, and progress
counts. They do not contact the production database or send email.

Migration 0010 includes the `preferred_time` column for fresh databases.
Production already has this column and records 0010 as applied; do not replay it.

```sh
# View seekers in local D1
npm run db:local -- --command="SELECT * FROM seekers"

# View seekers in production D1
npm run db:remote -- --command="SELECT id,name,email,house FROM seekers"

# Tail production Functions logs
npx wrangler pages deployment tail

# Re-apply a migration locally after editing
npm run migrate:local
```

---

## Coming next

- **Phase 2** (admin panel): Cloudflare Access setup, `/admin.html`, mark-progress modal, auto ring/title conferral.
- **Phase 3** (public reads): tracker, leaderboard, self-lookup at `/lookup.html`.
- **Phase 4** (cutover): lore pages back into per-page HTML, image extraction, final email copy review, retire `/legacy/v1.html` after the November Grand Gathering.

The full plan is at `~/.claude/plans/flickering-noodling-spindle.md`.
