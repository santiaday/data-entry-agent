-- ============================================================
-- Data Entry Agent tables
-- Structured logging for AI-powered Salesforce field extraction.
-- ============================================================

-- de_batches: one row per trigger event (manual single-record or SOQL batch)
CREATE TABLE public.de_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,

  -- What triggered this batch
  trigger_type text NOT NULL,                -- 'manual' | 'soql_query' | 'cli'
  soql_query text,                           -- null for manual single-record runs
  object_type text NOT NULL,                 -- 'Lead' | 'Opportunity'

  -- Execution flags
  dry_run boolean NOT NULL DEFAULT false,

  -- Status tracking
  status text NOT NULL DEFAULT 'pending',    -- 'pending' | 'running' | 'completed' | 'failed'
  total_records integer NOT NULL DEFAULT 0,
  completed_records integer NOT NULL DEFAULT 0,
  failed_records integer NOT NULL DEFAULT 0,

  -- Timing
  started_at timestamptz,
  completed_at timestamptz,
  error text,

  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.de_batches ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_de_batches_org_created ON public.de_batches(org_id, created_at DESC);
CREATE INDEX idx_de_batches_org_status ON public.de_batches(org_id, status);


-- de_runs: one row per Salesforce record processed
CREATE TABLE public.de_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES public.de_batches(id) ON DELETE CASCADE,

  -- The SF record being processed
  record_id text NOT NULL,                   -- Salesforce 18-char ID
  object_type text NOT NULL,                 -- 'Lead' | 'Opportunity'

  -- Status
  status text NOT NULL DEFAULT 'pending',    -- 'pending' | 'running' | 'completed' | 'failed'
  dry_run boolean NOT NULL DEFAULT false,

  -- Aggregate stats (denormalized for fast list queries)
  fields_extracted integer NOT NULL DEFAULT 0,
  fields_written integer NOT NULL DEFAULT 0,
  fields_skipped integer NOT NULL DEFAULT 0,
  fields_errored integer NOT NULL DEFAULT 0,

  -- Error details
  fetch_errors jsonb,                        -- [{ source, error }]
  batch_errors jsonb,                        -- [{ batchId, error }]
  error text,

  -- Timing
  duration_ms integer,
  started_at timestamptz,
  completed_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(batch_id, record_id)
);

ALTER TABLE public.de_runs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_de_runs_batch ON public.de_runs(batch_id);
CREATE INDEX idx_de_runs_org_created ON public.de_runs(org_id, created_at DESC);
CREATE INDEX idx_de_runs_org_record ON public.de_runs(org_id, record_id);


-- de_extractions: one row per field per run
CREATE TABLE public.de_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.de_runs(id) ON DELETE CASCADE,

  -- Field identification
  field_name text NOT NULL,                  -- SF API name (e.g., 'AI_Buyer_Persona__c')
  sf_object text NOT NULL,                   -- 'Lead' | 'Opportunity'
  batch_id text NOT NULL,                    -- extraction batch (e.g., 'firmographic')

  -- Values
  extracted_value text,                      -- what the agent extracted (null = could not extract)
  current_sf_value text,                     -- value currently in Salesforce before write
  write_mode text NOT NULL,                  -- 'overwrite' | 'fill_blank' | 'append'

  -- Quality signals
  confidence real,                           -- 0.0 to 1.0
  evidence text,                             -- source snippet or reasoning trace

  -- Outcome
  was_written boolean NOT NULL DEFAULT false,
  skip_reason text,                          -- 'dry_run' | 'field_not_blank' | 'validation_failed' | 'no_value_extracted' | 'low_confidence'
  validation_errors text[],                  -- validation failure messages

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(run_id, field_name)
);

ALTER TABLE public.de_extractions ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_de_extractions_run ON public.de_extractions(run_id);
CREATE INDEX idx_de_extractions_org_field ON public.de_extractions(org_id, field_name);
