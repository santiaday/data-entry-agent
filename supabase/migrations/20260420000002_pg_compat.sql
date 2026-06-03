-- =================================================
-- Plain-Postgres compatibility
-- =================================================
-- The earlier migrations enable Row Level Security (a Supabase convention).
-- This build connects with a single database user over a direct connection and
-- has no PostgREST/role separation, so RLS provides nothing and could only get
-- in the way. Disable it on every app table.

ALTER TABLE public.orgs              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.de_batches        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.de_runs           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.de_extractions    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.de_prompts        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.de_field_configs  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_entry_queue  DISABLE ROW LEVEL SECURITY;
