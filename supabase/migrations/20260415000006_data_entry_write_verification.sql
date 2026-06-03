-- ============================================================
-- Data Entry Agent — write verification.
-- After a non-dry run writes to Salesforce, we re-query SF to
-- capture what actually landed. Silent-failure cases (e.g. FLS
-- restricting field updates) become visible in the UI.
-- ============================================================

-- Post-write actual SF value, per field, per run.
-- For dry runs this stays null. For live runs, it holds whatever
-- SF returned when we re-queried the record after the PATCH.
ALTER TABLE public.de_extractions
  ADD COLUMN IF NOT EXISTS actual_sf_value_after_write text;

-- Surface SF PATCH errors + silent-failure counts at the run level.
-- [{ objectType: 'Opportunity', recordId: '006...', fieldsAttempted: 68,
--    fieldsVerifiedWritten: 42, silentlyDropped: 26, error: null }]
ALTER TABLE public.de_runs
  ADD COLUMN IF NOT EXISTS write_results jsonb;
