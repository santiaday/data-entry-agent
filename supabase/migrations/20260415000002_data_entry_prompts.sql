-- ============================================================
-- Data Entry Agent — editable system/user prompts with versioning.
-- Lets you edit the LLM prompts from the UI. Every save creates
-- a new version; the active version is the one used at run time.
-- ============================================================

CREATE TABLE public.de_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,

  version integer NOT NULL,                      -- monotonic, per-org
  name text,                                     -- optional human label
  notes text,                                    -- optional "why I changed this"

  system_prompt text NOT NULL,
  user_prompt_preamble text NOT NULL DEFAULT '', -- prepended before the "# Context Data" block

  is_active boolean NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(org_id, version)
);

ALTER TABLE public.de_prompts ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_de_prompts_org_active ON public.de_prompts(org_id, is_active);
CREATE INDEX idx_de_prompts_org_version ON public.de_prompts(org_id, version DESC);
