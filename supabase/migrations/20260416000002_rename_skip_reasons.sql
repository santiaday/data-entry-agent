-- ============================================================
-- Data Entry Agent — rename misleading skip reasons.
--
-- Historically, "validation_failed" was used for TWO distinct cases:
--   1. LLM returned null (no evidence in context)          → rename to "no_context_found"
--   2. LLM returned a value but it failed validation rules → keep as "validation_failed"
--
-- Also collapse the legacy "no_value_extracted" (older code path that set
-- this skip_reason via decideWrite for the same case) into "no_context_found".
--
-- After this migration:
--   - no_context_found   = LLM found nothing for this field (common; not an error)
--   - validation_failed  = LLM found something but it was bad (picklist/format/range)
-- ============================================================

BEGIN;

-- Legacy rows where the LLM returned null but the old code labelled it "validation_failed"
-- are identifiable by having extracted_value IS NULL.
UPDATE public.de_extractions
   SET skip_reason = 'no_context_found'
 WHERE skip_reason = 'validation_failed'
   AND extracted_value IS NULL
   AND org_id = '00000000-0000-0000-0000-000000000001';

-- Legacy "no_value_extracted" rows mean exactly the same thing.
UPDATE public.de_extractions
   SET skip_reason = 'no_context_found'
 WHERE skip_reason = 'no_value_extracted'
   AND org_id = '00000000-0000-0000-0000-000000000001';

COMMIT;
