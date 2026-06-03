-- ============================================================
-- Base schema.
--
-- This file establishes the single base dependency that every
-- data-entry migration FKs against: public.orgs. The orgs table
-- also holds the per-org integration credentials (Salesforce,
-- Gong, Outreach) read by the extraction pipeline.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,

  -- Salesforce JWT Bearer Flow credentials
  sf_instance_url text,
  sf_client_id text,
  sf_username text,
  sf_private_key text,

  -- Gong API credentials (added later by 20260414_data_entry_credentials.sql,
  -- but listed here in case anyone applies that migration out of order)
  gong_access_key text,
  gong_access_key_secret text,

  -- Outreach OAuth credentials
  outreach_client_id text,
  outreach_client_secret text,
  outreach_refresh_token text,

  -- Optional extra integration credentials (unused by the extraction pipeline)
  brain_repo_url text,
  brain_repo_token text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The app's single-org id (DEFAULT_ORG_ID in lib/constants.ts) is
-- '00000000-0000-0000-0000-000000000001'. Pre-create the row so the
-- pipeline can find it. Credentials still need to be set manually —
-- see supabase/seed.example.sql.
INSERT INTO public.orgs (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Org')
ON CONFLICT (id) DO NOTHING;
