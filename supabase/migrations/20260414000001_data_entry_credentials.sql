-- ============================================================
-- Add Gong and Outreach credential columns to orgs table.
-- Follows the same pattern as sf_instance_url, sf_client_id, etc.
-- ============================================================

ALTER TABLE public.orgs
  ADD COLUMN IF NOT EXISTS gong_access_key text,
  ADD COLUMN IF NOT EXISTS gong_access_key_secret text,
  ADD COLUMN IF NOT EXISTS outreach_client_id text,
  ADD COLUMN IF NOT EXISTS outreach_client_secret text,
  ADD COLUMN IF NOT EXISTS outreach_refresh_token text;
