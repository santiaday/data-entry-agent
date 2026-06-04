# Data Entry Agent

An AI agent that reads a Salesforce **Lead** or **Opportunity** (plus its related
Gong calls and Outreach activity), extracts structured field values with an LLM,
validates them, and writes them back to Salesforce — with full visibility into
every run, extraction, and confidence score.

It ships with a web console to:

- **Run** a single record or a **batch/backfill** over a SOQL query — optionally
  scoped to **specific fields only** (cheaper targeted backfills after editing a
  field or prompt)
- **Edit prompts** — the extraction system prompt is versioned and editable in the UI
- **Edit fields** — configure which fields are extracted, their types, options
  (picklists), instructions, and write mode (overwrite / fill-if-empty)
- **Inspect runs** — per-field extracted value, confidence, write decision, and the
  exact reasoning, plus fetch inventory (what data the agent saw)
- **Analytics** — throughput, write/skip rates, confidence distribution over time
- **Queue** — webhook-driven processing with a delay (so Gong call processing can
  finish before extraction runs)

> **Access control.** There are no user accounts. Set `APP_ACCESS_PASSWORD` to put
> the whole app behind a single shared password (one login, one cookie); leave it
> unset to run fully open. Either way, the app acts with full privileges once you're
> in — including writing to Salesforce — so also rely on your platform's network/
> access controls if it's internet-reachable.

> **Credentials live in env vars.** Salesforce, Gong, and Outreach credentials are
> read from environment variables first (falling back to the `orgs` table if unset).
> Keeping the Salesforce private key in env keeps it out of the database and its
> backups. See `.env.example`.

## Stack

- Next.js 15 (App Router) + React 19 + Tailwind
- PostgreSQL for all state and configuration (any Postgres — RDS, DeployBay, local)
- OpenAI for extraction/summarization
- Salesforce JWT Bearer Flow for read + write (no interactive login)

The app talks to Postgres directly via a single `DATABASE_URL`. Database access
goes through a small PostgREST-compatible adapter (`lib/db/pg-rest.ts`), so there
is no Supabase or other service dependency.

## Setup

### 1. Database

Point `DATABASE_URL` at any PostgreSQL database. **Migrations apply
automatically on server boot** (via `instrumentation.ts`) — the app creates all
its tables on first start. To apply them manually instead:

```bash
pnpm migrate          # applies supabase/migrations/*.sql, tracked in _migrations
```

Then add your integration credentials. **Preferred:** set them as environment
variables (`SF_*`, `GONG_*`, `OUTREACH_*` — see `.env.example`); this keeps the
Salesforce private key out of the database. **Alternatively**, copy
`supabase/seed.example.sql` to `seed.sql`, fill in the values, and run it against
the database (the `orgs` row is the fallback when env vars are unset).

> The migration SQL lives under `supabase/migrations/` for historical reasons —
> it's plain PostgreSQL and has no dependency on Supabase.

### 2. Environment

Copy `.env.example` to `.env.local` and fill in `DATABASE_URL` + `OPENAI_API_KEY`.

### 3. Run locally

```bash
pnpm install
pnpm dev          # http://localhost:3000  (redirects to /data-entry)
```

## Migrating data from an existing database

If you already have this data in another Postgres database (e.g. a Supabase
project), copy it all over in one shot — org credentials, prompts, field configs,
batches, runs, and extractions:

```bash
# Run the destination migrations first (or just boot the app once).
SOURCE_DATABASE_URL="postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres" \
DATABASE_URL="postgresql://...your-destination..." \
pnpm sync
```

- Find `SOURCE_DATABASE_URL` in the Supabase dashboard: Project Settings →
  Database → Connection string → **URI** (direct connection, port 5432).
- By default the destination `de_*`/queue tables are **replaced** so IDs match the
  source exactly; the `orgs` row is upserted. Pass `--no-replace` to upsert by id
  without clearing existing rows.
- Pass `--skip-orgs` to copy only the data tables and leave the `orgs` row alone —
  recommended when your credentials live in env vars, so the Salesforce private key
  is never written into the destination database.
- Only columns present in both databases are copied, so schema differences are
  handled gracefully.

## Backfill / CLI

Process records from the command line (great for historical backfills):

```bash
# Dry run a single record (logs extractions, writes nothing)
pnpm backfill -- --record-id 00Q... --object-type Lead --dry-run

# Backfill every matching record, 3 at a time
pnpm backfill -- --backfill-query "SELECT Id FROM Opportunity WHERE StageName = 'Proposal'" \
  --object-type Opportunity --concurrency 3

# Scope a backfill to specific fields only (much cheaper — useful after editing
# one field/prompt and propagating it to many records)
pnpm backfill -- --backfill-query "SELECT Id FROM Opportunity WHERE StageName = 'Proposal'" \
  --object-type Opportunity --fields AI_Buyer_Persona__c,AI_Use_Case__c

# Resume an interrupted backfill (skips already-completed records)
pnpm backfill -- --backfill-query "..." --object-type Opportunity --skip-completed

pnpm backfill -- --help
```

Backfills also run from the web console (Dashboard → Run batch), which creates the
same grouped batch you can monitor under **Batches**.

## Webhook + queue (optional)

For event-driven processing, point a Salesforce APEX trigger at:

```
POST /api/data-entry/webhook        (auth: WEBHOOK_SECRET)
```

Each webhook enqueues the record with a configurable delay. A scheduler then drains
the queue by calling:

```
GET /api/data-entry/process-queue   (auth: Authorization: Bearer ${CRON_SECRET})
```

This endpoint processes a batch of ready records per call (~10) and is safe to invoke
on a short interval. On a platform without built-in cron, use any external scheduler
(e.g. a cron job, GitHub Actions, or an uptime pinger with the bearer header).

## Deploy (Docker)

A production `Dockerfile` (Next.js standalone output) is at the repo root:

```bash
docker build -t data-entry-agent .
docker run -p 3000:3000 --env-file .env.local data-entry-agent
```

For DeployBay (or any platform that builds from a GitHub repo + Dockerfile): point it
at this repository, **enable the PostgreSQL database** (it injects `DATABASE_URL`),
and set the remaining environment variables from `.env.example` in the platform's
config. Migrations run automatically on first boot. The container listens on `PORT`
(default 3000).

## Project layout

```
app/                 Next.js routes
  data-entry/        UI: dashboard, search, prompts, fields, batches, runs, analytics
  api/data-entry/    API: run, batch, queue, webhook, prompts, fields, analytics, ...
components/data-entry/  React UI
lib/
  pipeline/          The extraction pipeline (fetch → extract → validate → write → log)
  sf/                Salesforce auth (JWT) + read-only SOQL validation/execution
  auth.ts            Single-user full-access context (no login)
  db/                Postgres pool + PostgREST-compatible query adapter + migrator
  supabase/          Thin client factories (return the pg adapter)
scripts/
  backfill.ts        CLI entrypoint
  migrate.ts         Apply migrations manually (pnpm migrate)
  outreach-oauth.ts  One-time helper to obtain an Outreach refresh token
supabase/migrations/ Database schema
```
