-- =================================================
-- Per-user attribution (LOCAL-DEV slim version)
-- =================================================
-- The prod version of this migration also alters public.messages,
-- public.ingest_log, public.query_log, public.conversations, and
-- public.reports — but those tables don't exist in the local-dev
-- subset that runs data-entry batches. This slim version touches
-- only the de_* tables that the pipeline actually writes to.
--
-- (The original multi-table version lived in a larger monorepo.)
-- and is not needed by this standalone build.

-- ── 1. Add user_id columns ────────────────────────

alter table public.de_batches
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.de_runs
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.de_extractions
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.de_prompts
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.de_field_configs
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- ── 2. Indexes for per-user analytics ─────────────

create index if not exists de_batches_user_created_idx
  on public.de_batches (org_id, user_id, created_at desc);

create index if not exists de_runs_user_created_idx
  on public.de_runs (org_id, user_id, created_at desc);

create index if not exists de_extractions_user_created_idx
  on public.de_extractions (org_id, user_id, created_at desc);

create index if not exists de_prompts_user_created_idx
  on public.de_prompts (org_id, user_id, created_at desc);

create index if not exists de_field_configs_user_idx
  on public.de_field_configs (org_id, user_id, created_at desc);
