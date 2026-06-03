-- =================================================
-- Webhook queue for Data Entry Agent
-- =================================================
-- Salesforce APEX triggers fire webhooks that land here. Each row represents
-- a single record that needs processing, with a configurable delay (default
-- 2 hours) to allow Gong call processing to complete before extraction.

CREATE TABLE public.data_entry_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,

  -- The SF record to process
  record_id text NOT NULL,
  object_type text NOT NULL,             -- 'Lead' | 'Opportunity'

  -- Trigger metadata
  trigger_event text NOT NULL,           -- 'after_insert' | 'after_update' | 'manual'
  trigger_payload jsonb,                 -- raw webhook body for debugging

  -- Scheduling
  scheduled_at timestamptz NOT NULL,     -- when to actually process (now + delay)
  delay_minutes int NOT NULL DEFAULT 120,

  -- Processing state
  status text NOT NULL DEFAULT 'waiting', -- 'waiting' | 'processing' | 'completed' | 'failed' | 'cancelled'
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  last_error text,

  -- Link to the pipeline run once processing starts
  run_id uuid REFERENCES public.de_runs(id),

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.data_entry_queue ENABLE ROW LEVEL SECURITY;

-- Service role only — no user-facing access
CREATE POLICY "Service role full access"
  ON public.data_entry_queue
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Find jobs ready to process
CREATE INDEX idx_deq_ready
  ON public.data_entry_queue (scheduled_at)
  WHERE status = 'waiting';

-- Prevent duplicate queuing for the same record (enforced at DB level)
CREATE UNIQUE INDEX idx_deq_dedup
  ON public.data_entry_queue (org_id, record_id, object_type)
  WHERE status IN ('waiting', 'processing');

-- Lookup by status for dashboard/analytics
CREATE INDEX idx_deq_org_status
  ON public.data_entry_queue (org_id, status, created_at DESC);
