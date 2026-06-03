-- ============================================================
-- Data Entry Agent — editable field configs.
-- Replaces the hard-coded FIELD_CONFIGS array with a database
-- table so users can add/edit/disable fields from the UI.
-- ============================================================

CREATE TABLE public.de_field_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,

  -- Stable identifier matching the code-seed ID so seeds are idempotent
  config_id text NOT NULL,

  sf_object text NOT NULL,                       -- 'Lead' | 'Opportunity'
  field_name text NOT NULL,                      -- SF API name e.g. 'AI_Buyer_Persona__c'
  value_type text NOT NULL,                      -- 'picklist' | 'text' | 'number' | etc
  batch_id text NOT NULL,                        -- 'firmographic' | etc
  instruction text NOT NULL,                     -- Natural-language prompt for the LLM
  write_mode text NOT NULL,                      -- 'overwrite' | 'fill_blank' | 'append'
  options text[],                                -- for picklist / multipicklist
  validation jsonb,                              -- { maxLength?, min?, max?, dateFormat? }

  is_active boolean NOT NULL DEFAULT true,       -- disable without deleting
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(org_id, config_id),
  UNIQUE(org_id, sf_object, field_name)
);

ALTER TABLE public.de_field_configs ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_de_field_configs_org_batch ON public.de_field_configs(org_id, batch_id);
CREATE INDEX idx_de_field_configs_org_active ON public.de_field_configs(org_id, is_active);
