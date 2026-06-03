# Data Entry Agent

An AI agent that reads a Salesforce **Lead** or **Opportunity** (plus its related
Gong calls and Outreach activity), extracts structured field values with an LLM,
validates them, and writes them back to Salesforce — with full visibility into
every run, extraction, and confidence score.

It ships with a web console to:

- **Run** a single record or a **batch/backfill** over a SOQL query
- **Edit prompts** — the extraction system prompt is versioned and editable in the UI
- **Edit fields** — configure which fields are extracted, their types, options
  (picklists), instructions, and write mode (overwrite / fill-if-empty)
- **Inspect runs** — per-field extracted value, confidence, write decision, and the
  exact reasoning, plus fetch inventory (what data the agent saw)
- **Analytics** — throughput, write/skip rates, confidence distribution over time
- **Queue** — webhook-driven processing with a delay (so Gong call processing can
  finish before extraction runs)

> **No authentication.** This build is single-user with no login — anyone who can
> reach the URL has full access, including the ability to write to Salesforce. Put
> it behind your platform's access controls / a private network, or don't expose it
> publicly. (Auth was intentionally removed; see `lib/auth.ts` to reintroduce it.)

## Stack

- Next.js 15 (App Router) + React 19 + Tailwind
- Supabase (Postgres) for all state and configuration
- OpenAI for extraction/summarization
- Salesforce JWT Bearer Flow for read + write (no interactive login)

## Setup

### 1. Database

Create a Supabase project (or any Postgres) and apply the migrations in
`supabase/migrations/` in filename order. With the [Supabase CLI](https://supabase.com/docs/guides/local-development):

```bash
supabase link --project-ref <your-ref>
supabase db push
```

Then add your integration credentials: copy `supabase/seed.example.sql` to
`seed.sql`, fill in the Salesforce (and optional Gong/Outreach) values, and run it.
Credentials live in the `orgs` table — **not** in environment variables.

### 2. Environment

Copy `.env.example` to `.env.local` and fill in Supabase + OpenAI values.

### 3. Run locally

```bash
pnpm install
pnpm dev          # http://localhost:3000  (redirects to /data-entry)
```

## Backfill / CLI

Process records from the command line (great for historical backfills):

```bash
# Dry run a single record (logs extractions, writes nothing)
pnpm backfill -- --record-id 00Q... --object-type Lead --dry-run

# Backfill every matching record, 3 at a time
pnpm backfill -- --backfill-query "SELECT Id FROM Opportunity WHERE StageName = 'Proposal'" \
  --object-type Opportunity --concurrency 3

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
at this repository and set the environment variables from `.env.example` in the
platform's config. The container listens on `PORT` (default 3000).

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
  supabase/          Server + service-role Supabase clients
scripts/
  backfill.ts        CLI entrypoint
  outreach-oauth.ts  One-time helper to obtain an Outreach refresh token
supabase/migrations/ Database schema
```
