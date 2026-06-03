-- ============================================================
-- Data Entry Agent — analytics columns.
-- Adds per-phase timing + per-batch token usage to de_runs
-- so you can see where time goes and what each run costs.
-- ============================================================

ALTER TABLE public.de_runs
  -- [{ phase: 'resolve', durationMs: 800 }, ...]
  ADD COLUMN IF NOT EXISTS phase_timings jsonb,

  -- [{ batchId: 'firmographic', durationMs: 3200,
  --    promptTokens: 4500, completionTokens: 850,
  --    status: 'success' }, ...]
  ADD COLUMN IF NOT EXISTS batch_executions jsonb,

  -- Aggregate OpenAI token usage
  ADD COLUMN IF NOT EXISTS total_prompt_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_completion_tokens integer NOT NULL DEFAULT 0;
