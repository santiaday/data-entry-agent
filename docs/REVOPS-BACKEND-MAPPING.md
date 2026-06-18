# UI → revops-agents schema mapping

The UI is now a thin control panel over revops-db, reached via the SQL endpoint
(`lib/supabase/server.ts` → `createServiceClient()` → remote executor). The
query-builder API is unchanged (`.from(...).select(...).eq(...)`), but:

- **Table names are schema-qualified** (the builder now supports `schema.table`).
- **No `org_id`** anywhere — config + run rows are scoped by `agent_ref`.
- The managed agent is `AGENT_REF` (env, default `sales/data-entry-agent`).
- Routes must **preserve their existing JSON response shape** so the React
  components keep working. Map new-schema columns back to the old field names.
- The acting user for writes is `ctx.email` (attribution) — write it into
  `created_by` / `updated_by` / `enqueued_by`.

## Table / column mapping

### `de_prompts` → `config.prompt_versions` (two slots per version)
A "prompt version" in the UI = a PAIR of config rows at the same `version`:
slot `'system'` (the orchestrator system prompt ↔ `system_prompt`) and slot
`'extraction'` (the extraction rules ↔ `user_prompt_preamble`).

| UI field | config.prompt_versions |
|---|---|
| `system_prompt` | row where slot='system' → `body` |
| `user_prompt_preamble` | row where slot='extraction' → `body` |
| `version` | `version` (shared across the two slots) |
| `is_active` | `is_active` (both slots flip together) |
| `notes` | `notes` |
| `created_at` | `created_at` |
| `name` | constant `'data-entry'` (synthesize) |

- **GET active+history:** read both slots, group by `version`, merge into the
  UI shape. Active = the version whose rows have `is_active=true`.
- **POST new version:** `version = max(version)+1`; deactivate current active
  rows for both slots; insert slot='system'(body=system_prompt) +
  slot='extraction'(body=user_prompt_preamble), both `is_active=true`,
  `created_by=ctx.email`.
- **POST [id] activate:** activate both slots at that version, deactivate others.
  (`id` in the UI = the system-slot row id; resolve its version, flip the pair.)

### `de_field_configs` → `config.field_definitions`
| UI field | config.field_definitions |
|---|---|
| `config_id` | `field_key` |
| `sf_object` | `sf_object` |
| `field_name` | `field_api_name` |
| `value_type` | `value_type` |
| `batch_id` | `group_key` |
| `write_mode` | `write_mode` |
| `instruction` | `instruction` |
| `options` (string[]) | `options` (jsonb) |
| `validation` (obj) | `validation` (jsonb) |
| `is_active` | `is_active` |
| `sort_order` | `sort_order` |

- New field insert: derive `field_key = lower(sf_object) + '.' + lower(field_api_name)`.
- Edit / disable: update by `field_key` (+ `agent_ref`). `updated_by=ctx.email`.

### `de_runs` → `runs.agent_runs`
| UI field | runs.agent_runs |
|---|---|
| `id` | `run_id` |
| `record_id` | `subject_id` |
| `object_type` | `trigger_payload->>'record_type'` (fallback `subject_kind`) |
| `status` | `status` |
| `dry_run` | `trigger_payload->>'dry_run'` |
| `created_at` | `started_at` |
| `error` | `error` (jsonb) |
Pipeline-only fields the UI had (`phase_timings`, `batch_executions`,
`fetch_inventory`, `write_results`) do not exist — return `null`/`[]`. The
run-detail's richer views now come from `runs.run_events`, `runs.llm_calls`,
and `runs.field_extractions`.

### `de_extractions` → `runs.field_extractions`
| UI field | runs.field_extractions |
|---|---|
| `field_name` | `field_api_name` (also expose `field_key`) |
| `object` / `sf_object` | `sf_object` |
| `record_id` | `record_id` |
| `extracted_value` | `extracted_value` |
| `current_value` | `before_value` |
| `after_value` | `after_value` |
| `confidence` | `confidence` |
| `evidence` | `evidence` |
| `skip_reason` | `skip_reason` |
| `validation_errors` | `validation_errors` (text[]) |
| `would_write` / write status | derive from `write_outcome` (written/dry_run/...) |
| `batch_id` / group | `group_key` |

### `data_entry_queue` → `runs.dispatch_queue`
| UI field | runs.dispatch_queue |
|---|---|
| `id` | `id` |
| `record_id` | `subject_id` |
| `object_type` | `payload->>'record_type'` |
| `status` | `status` (pending/dispatching/dispatched/failed/cancelled) |
| `attempts` | `attempts` |
| `max_attempts` | `max_attempts` |
| `created_at` | `enqueued_at` |
| `error` | `last_error` |
| `dispatched_run_id` | `dispatched_run_id` |

- **Enqueue (run/batch/skip):** INSERT `{agent_ref, subject_id: record_id,
  subject_kind: object_type, payload: {record_id, record_type, dry_run,
  field_groups?}, dry_run, enqueued_by: ctx.email}`. The revops-agents
  cron-driver dispatches it — the UI does NOT execute anything.

## Route dispositions
- `prompts`, `prompts/[id]`, `fields`, `fields/[id]`, `runs/[id]`, `search`,
  `queue`, `queue/[id]/skip`, `queue/process-ready`, `analytics`, `batches`,
  `batches/[id]` → rewrite to the mapping above; **preserve response shape**.
- `run` (single) → enqueue one dispatch_queue row + return `{ queued: true, id }`.
  (The old SSE stream is gone — the UI polls the run via `runs/[id]`.)
- `batch` → accept a list of `record_ids` (+ object_type + dry_run + field_groups);
  enqueue one row each; return `{ queued: <n> }`. SOQL-cohort resolution is a
  backend/local-tool concern (the UI can't reach Salesforce).
- `process-queue` (cron) → **obsolete** (revops-agents drains the queue). Return
  410 Gone with a short note. `webhook` → **obsolete** (SF intake is in
  revops-agents' API Gateway; DeployBay can't receive Apex). Return 410.
- `admin/import` → **disabled** (the UI does not own the DB). Return 410.

## Auth enforcement (unchanged pattern)
Every route still does:
```
const ctx = await getAuthContext();
if (!ctx.permissions.modules.data_entry.access) return 403;     // viewers OK to read
if (<mutation>) require ctx.permissions.modules.data_entry.can_edit_* / can_run_batches
```
`getAuthContext()` now resolves a real role (editor/viewer) — see `lib/auth.ts`.
