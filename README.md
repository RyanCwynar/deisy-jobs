# deisy-jobs

Private job-application tracker for Deisy. Next.js (App Router, TypeScript) with a local `@libsql/client` file database.

Production: [https://deisy.byldr.co](https://deisy.byldr.co) (`next start` behind Traefik).

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
| `INGEST_TOKEN` | yes | Env bearer with `ingest` (+ read/notes). Kept for upsert pipelines |
| `READ_TOKEN` | yes | Env bearer with `read` + `notes` |
| `APP_URL` | no | Base URL for magic links |
| `RESEND_API_KEY` | no | Enables magic-link email |
| `RESEND_FROM` | no | From address (default Resend onboarding) |
| `PORT` | no | Default `3010` |
| `RESUMES_DIR` | no | Resume PDF directory (default `./data/resumes`) |
| `RESUME_URL_SECRET` | no | HMAC for signed resume URLs (falls back to `SESSION_SECRET`) |

Schema migrations (including `api_tokens`, `resumes`, and relaxing note authors) run automatically via `ensureSchema` on first DB use and on server start (`src/instrumentation.ts`).

## Data model

- **applications** — upsert key `#` (zero-padded). CSV fields plus `status`, `status_reason`, `raw_status`, `done_at`, `updated_at`.
- **notes** — `id`, `application_id`, `author` (free-form string: `deisy` \| `ryan` \| `bot` \| token name e.g. `deisy-bot`), `body`, `created_at`.
- **api_tokens** — `id`, `name`, `scopes`, `token_hash` (sha256 of plaintext), `created_at`, `revoked_at`, `last_used_at`.
- **resumes** — versioned PDFs per `lang` (`en`\|`es`): `filename`, `content_type`, `size`, `sha256`, file under `RESUMES_DIR`, `created_at`. Latest per lang is current.
- **change_log** — audit of creates/updates: `id`, `at`, `actor`, `token_id`, `entity`, `entity_id`, `action`, `diff` (JSON).
- **tasks** — Deisy to-dos: `title`, `detail`, `kind` (`photo|video|audio|assessment|essay|account|answer|upload|interview|other`), `status` (`open|done|snoozed|dropped`), `priority`, `due_date`, `application_id` (primary convenience link), `created_by`, `done_at`, `reply`, `snoozed_until`, `seed_key` (idempotent seed).
- **task_applications** — join table (source of truth for multi-app links).

Status free text is normalized to a prefix: `Skipped`, `Parked`, `Submitted`, `Needs-Deisy`, `Closed`, `Found`. `Needs Deisy` ≡ `Needs-Deisy`. `status_reason` is the text after `:` or inside `(...)`.

Import is idempotent:

```bash
npx tsx scripts/import.ts [path/to.csv]
```

Seed tasks from open Needs-Deisy rows (idempotent; dedupes identical asks into one task linked to many apps):

```bash
npm run seed:tasks
```

## Auth scopes

Bearer tokens (env or DB) use scopes:

| Scope | Allows |
|---|---|
| `read` | List/get applications, updates, resumes, changes, tasks, MCP read tools |
| `notes` | Add notes + mark done (REST + MCP) |
| `write` | App/resume mutations + task create/update/complete/snooze/drop |
| `ingest` | REST upsert applications + REST upload resumes |

- Env `READ_TOKEN` → `read,notes`
- Env `INGEST_TOKEN` → `ingest,read,notes,write`
- Session login → `read,notes,write`
- DB tokens: any subset. **Scoped bot tokens without `ingest` can never REST-upsert.**

Send `Authorization: Bearer <token>` on MCP and REST routes.

Audit `actor` is the token name (e.g. `deisy-bot`), `ingest` for the env ingest token, or the session user email.

## Remote MCP (streamable HTTP)

| | |
|---|---|
| URL | `https://deisy.byldr.co/mcp` |
| Transport | Streamable HTTP (`@modelcontextprotocol/sdk`) |
| Auth | `Authorization: Bearer <token>` with at least the scopes each tool needs |

### Tools

| Tool | Scopes | Description |
|---|---|---|
| `list_applications` | `read` | Filters: `status`, `since`, `company` |
| `get_application` | `read` | Application + notes |
| `list_needs_deisy` | `read` | Open Needs-Deisy items |
| `mark_done` | `notes` | Mark done / reopen |
| `add_note` | `notes` | Author = token owner name (e.g. `deisy-bot`) |
| `list_resumes` | `read` | Current resume per lang (filename, size, updated_at, sha256) |
| `get_resume` | `read` | Embedded PDF (base64) + `signed_url` + `expires_at` |
| `upsert_application` | `write` | Create (auto id if omitted) or patch given fields |
| `update_status` | `write` | Status-only update (no delete; close via status) |
| `upload_resume` | `write` | PDF base64 → current version for `en`\|`es` |
| `list_changes` | `read` | Audit log (`since`, `actor`, `limit`) |
| `next_tasks` | `read` | Ranked open (+ due snoozed) tasks with app context |
| `list_tasks` | `read` | Filter by `status`, `application_id` |
| `create_task` | `write` | See field spec below |
| `update_task` | `write` | Patch title/detail/kind/priority/due_date/application_ids |
| `complete_task` | `write` | `{ id, note? }` |
| `snooze_task` | `write` | `{ id, until? \| days? }` |
| `drop_task` | `write` | `{ id }` |

Notes on applications: use existing `add_note` (`{ id, body }`) — no separate `add_application_note`.

#### `create_task` fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `title` | yes | string | Plain-language instruction |
| `detail` | no | string | Longer what-to-do + context |
| `kind` | yes | enum | `photo\|video\|audio\|assessment\|essay\|account\|answer\|upload\|interview\|other` |
| `application_ids` | yes | string[] | One or more application ids (join is source of truth) |
| `priority` | no | int | Higher = sooner (after linked-count + pay) |
| `due_date` | no | string \| null | ISO date/time |

Tool descriptions are bilingual (Spanish first, English after).

### Cursor / client config example

```json
{
  "mcpServers": {
    "deisy-jobs": {
      "url": "https://deisy.byldr.co/mcp",
      "headers": {
        "Authorization": "Bearer dj_…"
      }
    }
  }
}
```

## API tokens (mint / revoke / scopes)

Ryan-only UI: [/admin/tokens](https://deisy.byldr.co/admin/tokens) (linked from the dashboard when signed in as Ryan). Plaintext is shown once on mint.

CLI:

```bash
npm run token:mint -- --name deisy-bot --scopes read,notes,write
# Grant/replace scopes on an existing token (e.g. production deisy-bot):
npm run token:scopes -- <REDACTED_TOKEN> read,notes,write
npm run token:revoke -- --id <uuid>
# or revoke all active tokens with a name:
npm run token:revoke -- --name deisy-bot
```

## API summary

All routes except `/api/health` require auth. `/mcp` requires a Bearer token.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/health` | open | Liveness + app count |
| `POST` | `/api/applications/upsert` | Bearer with `ingest` | Body `{ applications: [...] }`, batch, idempotent |
| `GET` | `/api/applications` | session or Bearer `read` | Query: `status`, `since`, `company`, `from`, `to`, `cv` |
| `GET` | `/api/applications/:id` | session or Bearer `read` | App + notes |
| `GET` | `/api/updates?since=ISO` | session or Bearer `read` | Done marks + notes since |
| `POST` | `/api/applications/:id/notes` | session or Bearer `notes` | `{ body, author? }` — DB tokens force author = token name |
| `POST` | `/api/applications/:id/done` | session or Bearer `notes` | `{ done?: boolean }` |
| `POST` | `/api/resumes` | Bearer `ingest` | Multipart `file`+`lang`, or raw PDF + `?lang=` (PDF ≤10MB) |
| `GET` | `/api/resumes` | session or Bearer `read` | All resume versions (newest first) |
| `GET` | `/api/resumes/:lang/download` | signed `sig`+`exp` (15m HMAC) | Current PDF for lang |
| `GET` | `/api/changes` | session or Bearer `read` | Query: `since`, `actor`, `limit` |
| `GET` | `/api/tasks` | session or Bearer `read` | Query: `status`, `application_id` |
| `GET` | `/api/tasks/next` | session or Bearer `read` | Ranked queue (`limit`) |
| `POST` | `/api/tasks` | Bearer/session `write` | Create task |
| `PATCH` | `/api/tasks/:id` | Bearer/session `write` | Update task |
| `POST` | `/api/tasks/:id/complete` | Bearer/session `write` | `{ note? }` |
| `POST` | `/api/tasks/:id/snooze` | Bearer/session `write` | `{ until? \| days? }` |
| `POST` | `/api/tasks/:id/drop` | Bearer/session `write` | Drop task |
| `GET`/`POST`/`DELETE` | `/mcp` | Bearer | Remote MCP (streamable HTTP) |
| `GET`/`POST` | `/api/admin/tokens` | Ryan session | List / mint |
| `POST` | `/api/admin/tokens/:id/revoke` | Ryan session | Revoke |
| `POST` | `/api/auth/login` | open | Email + password → session cookie |
| `POST` | `/api/auth/logout` | session | Clears cookie |
| `POST` | `/api/auth/magic-link` | open | Requires `RESEND_API_KEY` |
| `GET` | `/api/auth/magic-verify` | token | Sets session, redirects `/` |

### Upsert example

```bash
curl -sS -X POST https://deisy.byldr.co/api/applications/upsert \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"applications":[{"id":"01","company":"Hexion","role":"Planner","status":"Skipped (not eligible)","cv":"EN"}]}'
```

### Read example

```bash
curl -sS "https://deisy.byldr.co/api/applications?status=Needs-Deisy" \
  -H "Authorization: Bearer $READ_TOKEN"
```

## UI

Mobile-first. Open **Needs Deisy** items are pinned at the top with mark-done and reply. **Your to-dos** (`/todos`) lists open tasks in `next_tasks` order with complete/snooze. Filters: status, date range, company search. EN/ES label toggle. All pages require login. Ryan sees a **Tokens** admin link.

## Tests

```bash
npm test
```

Covers status normalization, idempotent CSV import, upsert, API auth gates, token scopes/revocation, and MCP tool calls. Do **not** add Playwright/E2E jobs to GitHub Actions for this work.

## Deploy (deisy.byldr.co)

Do **not** run these from this agent session — ship artifacts only.

### Redeploy (typical host)

```bash
cd /opt/deisy-jobs-src   # or your checkout
git pull
npm ci
npm run build
# copy standalone output if using systemd layout:
# rm -rf /opt/deisy-jobs/*
# cp -a .next/standalone/. /opt/deisy-jobs/
# cp -a .next/static /opt/deisy-jobs/.next/static
# cp -a public /opt/deisy-jobs/public
# keep existing data/ and .env
sudo systemctl restart deisy-jobs
```

Or Docker:

```bash
docker build -t deisy-jobs .
docker stop deisy-jobs && docker rm deisy-jobs
docker run -d --name deisy-jobs -p 127.0.0.1:3010:3010 \
  --env-file .env \
  -v deisy-jobs-data:/app/data \
  deisy-jobs
```

### Mint a bot token after deploy

```bash
cd /opt/deisy-jobs-src   # where package.json + data/ (or DATABASE_URL) point at prod DB
npm run token:mint -- --name deisy-bot --scopes read,notes
# copy the plaintext once into the MCP client Authorization header
```

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
| `scripts/token-mint.ts` | Mint DB API token (plaintext once) |
| `scripts/token-scopes.ts` | Set scopes on an existing token by id |
| `scripts/token-revoke.ts` | Revoke by `--id` or `--name` |
| `scripts/seed-tasks.ts` | Idempotent Needs-Deisy → tasks seed |
