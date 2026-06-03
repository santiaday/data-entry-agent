-- =====================================================================
-- Credential seed for the single org.
--
-- The base migration (00000000000001_base_orgs.sql) already inserts the
-- org row with id = '00000000-0000-0000-0000-000000000001'. This file
-- fills in the integration credentials the extraction pipeline reads.
--
-- Copy to seed.sql, fill in real values, and run it against your database
-- (e.g. via the Supabase SQL editor, or `psql < seed.sql`).
--
-- Salesforce uses the JWT Bearer Flow (server-to-server, no interactive
-- login). You need a Connected App with a certificate; sf_private_key is
-- the PEM private key whose public cert is uploaded to that Connected App.
-- =====================================================================

UPDATE public.orgs
SET
  name                    = 'Default Org',

  -- Salesforce (required)
  sf_instance_url         = 'https://yourcompany.my.salesforce.com',
  sf_client_id            = 'CONSUMER_KEY_FROM_CONNECTED_APP',
  sf_username             = 'integration.user@yourcompany.com',
  sf_private_key          = '-----BEGIN PRIVATE KEY-----
...your PEM key...
-----END PRIVATE KEY-----',

  -- Gong (optional — only if extracting from Gong calls)
  gong_access_key         = NULL,
  gong_access_key_secret  = NULL,

  -- Outreach (optional — run `pnpm oauth:outreach` to obtain the refresh token)
  outreach_client_id      = NULL,
  outreach_client_secret  = NULL,
  outreach_refresh_token  = NULL
WHERE id = '00000000-0000-0000-0000-000000000001';
