# deisy-jobs

Private job-application tracker for Deisy. Next.js (App Router, TypeScript) with a local `@libsql/client` file database.

## Quick start

```bash
cp .env.example .env
# edit .env — set SESSION_SECRET, emails, bcrypt hashes, tokens

npx tsx scripts/hash-password.ts 'choose-a-password'
# paste the escaped hash into DEISY_PASSWORD_HASH / RYAN_PASSWORD_HASH
# (Next.js expands $ in .env — use the escaped line the script prints)

npm install
npx tsx scripts/import.ts          # idempotent CSV → data/deisy-jobs.db
npm run dev -- -p 3010
```

Open [http://127.0.0.1:3010](http://127.0.0.1:3010) and sign in.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | libSQL URL, e.g. `file:./data/deisy-jobs.db` |
| `SESSION_SECRET` | yes | HMAC secret for httpOnly session cookie (≥16 chars) |
| `DEISY_EMAIL` / `DEISY_PASSWORD_HASH` | yes | Deisy login |
| `RYAN_EMAIL` / `RYAN_PASSWORD_HASH` | yes | Ryan login |
| `INGEST_TOKEN` | yes | Bearer for `POST /api/applications/upsert` |
| `READ_TOKEN` | yes | Bearer for read APIs (INGEST also accepted) |
| `APP_URL` | no | Base URL for magic links |
| `RESEND_API_KEY` | no | Enables magic-link email |
| `RESEND_FROM` | no | From address (default Resend onboarding) |
| `PORT` | no | Default `3010` |

## Data model

- **applications** — upsert key `#` (zero-padded). CSV fields plus `status`, `status_reason`, `raw_status`, `done_at`, `updated_at`.
- **notes** — `id`, `application_id`, `author` (`deisy` \| `ryan` \| `bot`), `body`, `created_at`.

Status free text is normalized to a prefix: `Skipped`, `Parked`, `Submitted`, `Needs-Deisy`, `Closed`, `Found`. `Needs Deisy` ≡ `Needs-Deisy`. `status_reason` is the text after `:` or inside `(...)`.

Import is idempotent:

```bash
npx tsx scripts/import.ts [path/to.csv]
```

## API summary

All routes except `/api/health` require auth.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/health` | open | Liveness + app count |
| `POST` | `/api/applications/upsert` | `Bearer INGEST_TOKEN` | Body `{ applications: [...] }`, batch, idempotent |
| `GET` | `/api/applications` | session or `READ`/`INGEST` | Query: `status`, `since`, `company`, `from`, `to`, `cv` |
| `GET` | `/api/applications/:id` | session or `READ`/`INGEST` | App + notes |
| `GET` | `/api/updates?since=ISO` | session or `READ`/`INGEST` | Done marks + notes since |
| `POST` | `/api/applications/:id/notes` | session or `READ` | `{ body, author? }` |
| `POST` | `/api/applications/:id/done` | session or `READ` | `{ done?: boolean }` |
| `POST` | `/api/auth/login` | open | Email + password → session cookie |
| `POST` | `/api/auth/logout` | session | Clears cookie |
| `POST` | `/api/auth/magic-link` | open | Requires `RESEND_API_KEY` |
| `GET` | `/api/auth/magic-verify` | token | Sets session, redirects `/` |

### Upsert example

```bash
curl -sS -X POST https://jobs.byldr.co/api/applications/upsert \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"applications":[{"id":"01","company":"Hexion","role":"Planner","status":"Skipped (not eligible)","cv":"EN"}]}'
```

### Read example

```bash
curl -sS "https://jobs.byldr.co/api/applications?status=Needs-Deisy" \
  -H "Authorization: Bearer $READ_TOKEN"
```

## UI

Mobile-first. Open **Needs Deisy** items are pinned at the top with mark-done and reply. Filters: status, date range, company search. EN/ES label toggle. All pages require login.

## Tests

```bash
npm test
```

Covers status normalization, idempotent CSV import, upsert, and API auth gates.

## Deploy (jobs.byldr.co)

Do **not** run these from this agent session — ship artifacts only.

### Option A — standalone build + systemd

```bash
# on the host
git clone <repo> /opt/deisy-jobs-src
cd /opt/deisy-jobs-src
cp .env.example /opt/deisy-jobs/.env   # fill secrets
npm ci
DATABASE_URL=file:./data/deisy-jobs.db npx tsx scripts/import.ts
npm run build

# copy standalone output
rm -rf /opt/deisy-jobs/*
cp -a .next/standalone/. /opt/deisy-jobs/
cp -a .next/static /opt/deisy-jobs/.next/static
cp -a public /opt/deisy-jobs/public
cp -a data /opt/deisy-jobs/data
cp .env /opt/deisy-jobs/.env

sudo cp deploy/deisy-jobs.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now deisy-jobs
```

Service listens on **127.0.0.1:3010**.

### Option B — Docker

```bash
docker build -t deisy-jobs .
docker run -d --name deisy-jobs -p 127.0.0.1:3010:3010 \
  --env-file .env \
  -v deisy-jobs-data:/app/data \
  deisy-jobs
```

### nginx

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/jobs.byldr.co
sudo ln -sf /etc/nginx/sites-available/jobs.byldr.co /etc/nginx/sites-enabled/
# uncomment SSL lines after certbot
sudo certbot --nginx -d jobs.byldr.co
sudo nginx -t && sudo systemctl reload nginx
```

Point DNS `jobs.byldr.co` A/AAAA at the host before issuing the cert.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/import.ts` | Idempotent CSV import |
| `scripts/hash-password.ts` | Generate bcrypt hash for env |
