# Spec: Move the Data Entry Agent execution to `revops-agents`, keep DeployBay as the frontend

**Status:** Proposal for the `revops-agents` repo
**Author:** (handoff from the `data-entry-agent` repo)
**Audience:** whoever implements this in `revops-agents` (human or agent)

---

## 1. Goal / end state

Today the **Data Entry Agent** is one self-contained Next.js app deployed on DeployBay:
it has the UI *and* runs the extraction pipeline *and* owns its database.

The target end state:

- **Execution plane → `revops-agents` (AWS).** The webhook intake, job queue, the
  extraction pipeline (fetch → extract → validate → write to Salesforce), and all
  result logging run on revops-agents infrastructure (Lambda + Step Functions),
  using revops-agents' existing Salesforce auth and Secrets Manager.
- **Data → `revops-db`** (the RevOps RDS Postgres), in a dedicated `data_entry`
  schema. Single source of truth.
- **Frontend plane → DeployBay.** The existing Next.js app becomes a thin UI:
  dashboard, run history, run detail, analytics, and the **prompt / field-config
  editors**. It triggers runs and reads results through revops-agents; it no longer
  executes the pipeline or writes to Salesforce.

Why: DeployBay structurally cannot receive Salesforce webhooks. Every app-subdomain
request is forced through an ingress `auth_request → /api/__grant_verify` cookie
handshake (302 → `/api/grant` → `dlp_grant` cookie); there is **no header-token /
machine bypass**. Salesforce APEX callouts can't complete that handshake. revops-agents
already exposes a public API Gateway with bearer auth and already receives Salesforce
webhooks, so execution belongs there.

---

## 2. The two planes

```
                      ┌───────────────────────────── EXECUTION (revops-agents, AWS) ─────────────────────────────┐
 Salesforce APEX ───▶ │ API Gateway → webhooks Lambda (enqueue)                                                   │
 (after_update,       │      │                                                                                    │
  after_insert)       │      ▼                                                                                    │
                      │  data_entry.data_entry_queue ──▶ scheduler ──▶ Step Function / Lambda: runPipeline()      │
                      │                                                   │ resolve→fetch→extract→validate→write   │
                      │                                                   ▼                                        │
                      │                                            Salesforce (REST PATCH writes)                 │
                      │  writes runs/batches/extractions ──▶ revops-db  (schema: data_entry.*)                    │
                      └──────────────────────────────────────────────▲───────────────────────────────────────────┘
                                                                      │  read results / write config / trigger runs
                      ┌──────────────── FRONTEND (DeployBay) ─────────┴───────────────┐
                      │ Next.js UI: dashboard, runs, run detail, analytics,           │
                      │ prompt editor, field-config editor, "run now" / batch trigger │
                      └───────────────────────────────────────────────────────────────┘
```

**Integration contract between the planes = the `data_entry` Postgres schema** (§5) plus
a small set of HTTPS endpoints (§6.3, §6.6). Nothing else couples them.

---

## 3. Division of responsibility

| Concern | Execution (revops-agents) | Frontend (DeployBay) |
|---|---|---|
| Receive Salesforce webhooks | ✅ | ❌ (impossible there) |
| Job queue + scheduling | ✅ | ❌ |
| Extraction pipeline (OpenAI) | ✅ | ❌ |
| Salesforce reads (SOQL) + writes (PATCH) | ✅ | ❌ |
| Gong / Outreach fetch | ✅ | ❌ |
| Salesforce / Gong / Outreach / OpenAI **credentials** | ✅ (Secrets Manager) | ❌ (none) |
| Write run/batch/extraction records | ✅ | ❌ |
| **Field configs + prompts** (read) | ✅ (pipeline reads them) | ✅ (editor reads them) |
| **Field configs + prompts** (write/edit) | ❌ | ✅ |
| Dashboard / run history / run detail / analytics | ❌ | ✅ (read-only views) |
| Trigger a run / batch / backfill | initiates execution | ✅ (sends the request) |

---

## 4. What to port (canonical source)

All execution logic already exists, fully working, in the `data-entry-agent` repo. Port
the logic; don't rewrite from scratch. Canonical files:

| Area | Path in `data-entry-agent` | Notes |
|---|---|---|
| Pipeline orchestrator | `lib/pipeline/run.ts` | `runPipeline()` — the 6-phase flow (§6.5) |
| Fetch (SF/Gong/Outreach) | `lib/pipeline/fetch/*` | orchestrator, salesforce, gong, outreach, credentials, inventory |
| Extraction (OpenAI) | `lib/pipeline/extract/*` | `batch-runner.ts` (chunking, field scoping), `prompt-builder.ts`, `openai-client.ts`, `response-parser.ts` |
| Validate + write mode | `lib/pipeline/validate/*` | type validators, overwrite/fill_blank/append |
| Salesforce write | `lib/pipeline/write/sf-writer.ts` | REST PATCH + verify |
| Context compile | `lib/pipeline/context/*` | token budget, section builders |
| Relationship resolve | `lib/pipeline/resolve/*` | builds the record graph |
| Config loaders | `lib/pipeline/config/*` | field configs, prompts, batches, picklists, seeding |
| Run logging | `lib/pipeline/logging/run-logger.ts` | createBatch/createRun/completeRun/logExtractions |
| Salesforce auth + SOQL | `lib/sf/*` | JWT bearer (`auth.ts`), SOQL exec/validate. **Replace auth with revops `trust.ts`.** |
| DB schema | `supabase/migrations/*.sql` | the `de_*` / `orgs` / `data_entry_queue` DDL → re-target to `data_entry` schema |
| Backfill CLI | `scripts/backfill.ts` | reference for batch/backfill + `--fields` scoping + resume |
| API request/response shapes | `app/api/data-entry/*` | webhook, run, batch, runs, batches, analytics, prompts, fields, queue, process-queue |

The pipeline is plain TypeScript using `pg`, `openai`, `jsonwebtoken`, and `fetch`. The
revops webhooks runtime is `nodejs24.x` + `pg` — directly compatible.

---

## 5. Integration contract — the `data_entry` schema (revops-db)

Create these tables in **`revops-db`** under a dedicated **`data_entry`** schema (NOT
`public` — avoids colliding with existing RevOps tables, notably `orgs`). The exact DDL
is in `data-entry-agent/supabase/migrations/`; re-target it to `data_entry.*`.

Tables:

- `data_entry.orgs` — single row; **id only** (`'00000000-0000-0000-0000-000000000001'`).
  The credential columns in the original migration are **dropped** here — credentials
  live in Secrets Manager on the execution plane.
- `data_entry.de_field_configs` — the editable field set: `config_id, sf_object,
  field_name, value_type, batch_id, instruction, write_mode, options text[],
  validation jsonb, is_active`. **Written by the frontend**, read by the pipeline.
- `data_entry.de_prompts` — versioned extraction prompt: `version, name, notes,
  system_prompt, user_prompt_preamble, is_active`. **Written by the frontend**, read by
  the pipeline.
- `data_entry.de_batches` — one row per batch/backfill/run group: `trigger_type
  (manual|soql_query|cli|webhook), soql_query, object_type, dry_run, status,
  total_records, completed_records, failed_records, timings, error`. Written by execution.
- `data_entry.de_runs` — one row per record processed: `batch_id, record_id,
  object_type, status, dry_run, fields_extracted/written/skipped/errored,
  fetch_errors jsonb, batch_errors jsonb, error, duration_ms, timings,
  phase_timings jsonb, batch_executions jsonb, fetch_inventory jsonb,
  write_results jsonb`. Written by execution; read by the UI.
- `data_entry.de_extractions` — one row per field per run: `run_id, batch_id,
  field_name, sf_object, extracted_value, current_sf_value, write_mode, confidence,
  evidence, was_written, skip_reason, validation_errors text[]`. Written by execution;
  read by the UI run-detail view.
- `data_entry.data_entry_queue` — webhook-driven work queue: `record_id, object_type,
  trigger_event, trigger_payload jsonb, delay_minutes, scheduled_at, status
  (waiting|processing|completed|failed|skipped), attempts`. Has a **unique partial
  index** that de-dupes "already queued" records — preserve it.

Notes:
- `user_id` columns exist for attribution but are nullable with **no FK** (there is no
  auth in this build). Keep them nullable; execution sets `null`.
- `text[]` columns (`options`, `validation_errors`) and `jsonb` columns must keep their
  types — the frontend's DB adapter encodes them type-aware.
- Migration mechanics: the `data-entry-agent` repo ships an idempotent runner
  (`lib/db/migrate.ts`) that tracks applied files in a `_migrations` table. revops-agents
  can reuse that approach or fold the DDL into its own migration tooling
  (`services/webhooks/migrations/NNNN_*.sql` style). Either way: **target the
  `data_entry` schema** and run once against `revops-db`.

---

## 6. Execution plane — what revops-agents must implement

### 6.1 Database access
The pipeline connects to `revops-db` with `pg` and `SET search_path = data_entry, public`
(or schema-qualify every table). The webhooks Lambda is already VPC-attached and can
reach `revops-db` privately; reuse the existing DB credential secret pattern (e.g. a
`revops-db/service/...` Secrets Manager ARN) with a role scoped to the `data_entry` schema.

### 6.2 Secrets (Secrets Manager)
The pipeline needs, per the original `.env.example`:
- **Salesforce JWT Bearer**: instance URL, client id (Connected App consumer key),
  username, RSA private key. **Reuse revops-agents' existing Salesforce auth**
  (`services/runtime/src/lib/trust.ts` / the SF signing secret) rather than the original
  `lib/sf/auth.ts` env reads — adapt `getSalesforceToken()` to source the JWT the revops
  way.
- **OpenAI**: API key (extraction uses `gpt-4o`; summarization `gpt-4o-mini`).
- **Gong** (optional): access key + secret (+ region base URL — note the original
  hardcodes a region default; make it configurable).
- **Outreach** (optional): client id/secret + refresh token.

### 6.3 Webhook intake (Salesforce → enqueue)
Extend the existing `handlers/salesforce.ts` (or add a sibling route) to accept a
data-entry enqueue. Contract (from `app/api/data-entry/webhook/route.ts`):
- **Auth:** bearer shared secret (revops convention; the original used `WEBHOOK_SECRET`).
- **Body:** `{ recordId, objectType: 'Lead'|'Opportunity', event?: 'after_insert'|'after_update'|'manual', delayMinutes?: 0..1440 }`.
- **Behavior:** insert into `data_entry.data_entry_queue` with `scheduled_at = now() +
  delay` (default delay **120 min** — gives Gong time to process the call first). The
  unique index makes duplicates a no-op (`{queued:false, reason:'duplicate'}`).
- **Salesforce side:** point the existing APEX trigger/callout at the revops API Gateway
  URL with the bearer header. (This is the whole reason for the move — it works here.)

### 6.4 Queue drainer (scheduler → pipeline)
Mirror the existing **CohortDispatcher → Step Function** pattern, or a scheduled Lambda:
- On a schedule (e.g. every 1–5 min), claim due rows: `status='waiting' AND scheduled_at
  <= now()`, ordered by `scheduled_at`, limited (the original does ~10/tick), marking
  them `processing` atomically.
- For each claimed record, run `runPipeline()` (§6.5). Process records concurrently
  (original default ~10) but cap concurrency to respect OpenAI + SF API limits.
- On success/failure, update the queue row and the `de_runs` row. Retries: bump
  `attempts`; cap and mark `failed`.
- Reference: `app/api/data-entry/process-queue/route.ts` and `queue/process-ready`.

### 6.5 The pipeline (`runPipeline`) — port verbatim
Per `lib/pipeline/run.ts`, for a single `{recordId, objectType, orgId, dryRun,
fieldNames?, fieldBatches?}`:

0. **setup** — create `de_batches` (if not part of an existing batch) + `de_runs` rows
   immediately, so every attempt leaves a paper trail even if later phases throw.
1a. **resolve** — build the relationship graph from the record (SOQL).
1b. **fetch** — load Gong/Outreach creds; fetch SF fields + Gong calls + Outreach
   activity in parallel; record per-source fetch errors (don't hard-fail the run).
2. **compile** — assemble a single token-budgeted context from all sources.
3. **extract** — `runExtractionBatches()`: filter field configs by `objectType` ∩
   `fieldBatches` ∩ **`fieldNames`** (the field-scoping feature — see below), chunk
   (~25 fields/call, concurrency ~8), call OpenAI per chunk, parse JSON results.
4a. **validate** — fetch current SF values for the extracted fields; run type validation
   and the write-mode decision (`overwrite` / `fill_blank` / `append`).
4b. **write** — unless `dryRun`, PATCH the values to Salesforce via REST and verify.
5. **log** — `completeRun` (stats, timings, token usage, fetch/write inventory) +
   `logExtractions` (per-field rows) + `completeBatch` (authoritative totals).

Cross-cutting:
- **Field scoping (`fieldNames`)** — restrict extraction/write to specific SF API field
  names. Fewer fields → fewer chunks → the large context is re-sent fewer times →
  meaningfully cheaper targeted backfills. Preserve this; it's a core feature.
- **Dry run** — extract + log, no SF writes.
- **Resume / skip-completed** — backfills can skip records already `completed` in
  `de_runs` (same object + dry-run flag) so an interrupted backfill resumes idempotently.
- **Error handling** — pre-run failures still write a synthetic failed `de_runs` row;
  per-phase timings recorded; fetch/batch errors captured on the run.

### 6.6 Trigger API (for the frontend)
The frontend needs to start work. Two endpoints (both bearer-auth'd on the revops API GW):
- **Single / batch "run now":** accept `{ objectType, recordId? | soqlQuery?, dryRun,
  fieldNames? }`. For a SOQL batch, the executor runs the query, creates a `de_batches`
  parent, and processes up to N records. Mirrors `app/api/data-entry/run` and
  `app/api/data-entry/batch`. Simplest implementation: **enqueue** into
  `data_entry_queue` with `delay=0` and let the drainer handle it (loses live SSE
  progress but keeps one execution path — acceptable for v1).
- **Backfill:** same as batch but large; reference `scripts/backfill.ts` (concurrency,
  `--fields`, `--skip-completed`).

### 6.7 Salesforce trigger
Provide/adjust the APEX so Salesforce posts to the revops webhook URL on the relevant
Lead/Opportunity events, with the bearer secret. (The pipeline expects 15–18 char SF IDs.)

---

## 7. Frontend plane — DeployBay changes

The DeployBay app stays, minus execution. Required changes:

1. **Remove pipeline execution from the app.** Delete/disable the local pipeline invocation
   in `app/api/data-entry/run`, `batch`, `process-queue`, `queue/*`. These become
   thin proxies that call the revops trigger API (§6.6), or are removed if the UI calls
   revops directly.
2. **Repoint data access** (pick one — see §9 Decision A):
   - **(Recommended) Via revops HTTPS** — route the frontend's data-access adapter
     (`lib/db/pg-rest.ts`, which already *builds* SQL) through revops-agents' existing
     **`POST /db/{database}/sql`** query endpoint (per-identity bearer). No direct DB
     connection, **no EKS↔revops-db network change**. Implement a new adapter executor
     that POSTs the generated SQL+params instead of using a pg pool.
   - **(Alternative) Direct DB** — set the DeployBay app `DATABASE_URL` → `revops-db`
     and `search_path=data_entry`. Requires devops to allow the EKS egress IP on
     `revops-db-sg` (or VPC-peer `prod-eks-vpc` ↔ `revops-vpc`).
3. **Keep** all read views (dashboard, batches, runs, run detail, analytics) and the
   **prompt + field-config editors** (these write `de_prompts` / `de_field_configs`).
4. **Trigger buttons** ("Run", "Start Batch", field-scoped batch) call the revops trigger
   API (§6.6) instead of executing locally.
5. **Access control:** keep `APP_ACCESS_PASSWORD` (or rely on DeployBay's SSO gate) — the
   UI is the only thing exposed on DeployBay now, and it no longer holds credentials.

---

## 8. Requirements / prerequisites

**Infra / devops:**
- [ ] `data_entry` schema created in `revops-db`; a DB role for the pipeline (RW on
      `data_entry.*`) and, if using the query endpoint, a `query_user_switcher` identity
      + bearer for the frontend (read on views + write on `de_prompts`/`de_field_configs`).
- [ ] Secrets in Secrets Manager: Salesforce JWT (reuse existing), OpenAI, Gong (opt),
      Outreach (opt). Wire ARNs into the SAM template like the existing handlers.
- [ ] Webhook route added to the webhooks SAM stack (or salesforce handler extended) +
      a bearer secret for it.
- [ ] Queue drainer: a scheduled Lambda or Step Function (EventBridge rule) with
      appropriate concurrency + timeout (pipeline runs ~30s–3m/record; API GW's 29s cap
      means the drainer must be async/SFN, not a synchronous API call).
- [ ] **Decision A** resolved (frontend data access — query endpoint vs direct DB). If
      direct DB: EKS egress allowlisted on `revops-db-sg`.

**Salesforce:**
- [ ] Connected App / JWT cert already used by revops-agents covers the API + write
      scopes for Lead/Opportunity fields.
- [ ] APEX trigger/callout points at the revops webhook URL with the bearer secret.

---

## 9. Open decisions (with recommendations)

- **A. Frontend data access:** revops `POST /db/{database}/sql` query endpoint
  (**recommended** — no network change, reuses existing secure infra) **vs** direct
  `DATABASE_URL` to `revops-db` (needs SG/peering). Either keeps the §5 schema as the
  contract.
- **B. Manual/single-run UX:** async-via-queue (**recommended for v1**, simplest, one
  execution path; UI polls the run row) **vs** a synchronous streaming run endpoint on
  revops (preserves the current live SSE progress, more work — API GW 29s cap forces
  WebSocket/SSE infra).
- **C. Is data-entry "another agent" in the runtime, or its own module?** The runtime
  already has agents (csm/risk/sales) + an `agent-runner` SFN + `cohort-dispatcher`.
  Modeling data-entry as a runtime agent reuses orchestration/observability; a standalone
  module is more isolated. Recommend whichever the revops team prefers — the pipeline
  logic is identical either way.
- **D. Org model:** single hardcoded org id vs adopting revops' org/tenant concept.
  Recommend keeping the single constant id to minimize churn.

---

## 10. Phased rollout

1. **Schema** — create `data_entry.*` in `revops-db`. (Reversible; additive.)
2. **Pipeline port** — land `runPipeline` + fetch/extract/validate/write + SF auth
   (via revops `trust.ts`) as a Lambda; verify with a **dry-run** on a known record
   (writes `de_runs`/`de_extractions`, no SF writes).
3. **Queue + drainer** — enqueue + scheduled drain; dry-run end-to-end.
4. **Webhook** — add the route; point a Salesforce sandbox trigger at it; confirm enqueue.
5. **Frontend cutover** — repoint DeployBay data access (Decision A) at the new schema;
   trigger buttons call revops; verify the UI shows runs the Lambda produced.
6. **Go live** — flip Salesforce prod trigger to the revops URL; enable real (non-dry)
   writes; monitor.
7. **Decommission** — drop the DeployBay per-app DB; remove pipeline code from the
   DeployBay app.

Roll back at any phase by leaving the DeployBay app pointed at its own DB until the new
path is verified.

---

## 11. Acceptance criteria

- A Salesforce `after_update` on an Opportunity reaches the revops webhook and creates a
  `data_entry.data_entry_queue` row (deduped).
- The drainer processes it: a `de_runs` row completes with `de_extractions`, and (non-dry)
  the values appear on the Salesforce record.
- A **field-scoped** batch (`fieldNames=[...]`) only extracts/writes those fields and runs
  cheaper (fewer chunks) than an all-fields run.
- The DeployBay UI shows the run in history, opens run detail with per-field
  value/confidence/write decision, and analytics updates.
- Editing a prompt or field config in the DeployBay UI changes what the **next** revops
  run extracts (config read from the shared schema).
- Dry-run produces extractions with zero Salesforce writes.

---

## 12. Appendix — env/behavior reference

- Original env surface: `data-entry-agent/.env.example` (DB, OpenAI, SF JWT, Gong,
  Outreach, webhook/cron secrets).
- Default webhook delay: 120 min (Gong processing lead time).
- Extraction chunking: ~25 fields/call, concurrency ~8; context re-sent per chunk (this
  is why field scoping saves cost).
- Write modes: `overwrite`, `fill_blank`, `append`.
- Dedup: unique partial index on the queue prevents duplicate in-flight records.
- Resume: backfills skip `de_runs.status='completed'` for the same object + dry-run flag.
```
