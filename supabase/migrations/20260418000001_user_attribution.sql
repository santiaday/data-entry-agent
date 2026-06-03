-- =================================================
-- Per-user attribution columns
-- =================================================
-- Adds a nullable user_id to the de_* tables the pipeline writes to. This
-- standalone build has no authentication, so user_id is always NULL and there
-- is no foreign key to an auth schema — the column exists only so the original
-- code paths and per-user analytics indexes are preserved.

-- ── 1. Add user_id columns ────────────────────────

alter table public.de_batches      add column if not exists user_id uuid;
alter table public.de_runs         add column if not exists user_id uuid;
alter table public.de_extractions  add column if not exists user_id uuid;
alter table public.de_prompts      add column if not exists user_id uuid;
alter table public.de_field_configs add column if not exists user_id uuid;

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
