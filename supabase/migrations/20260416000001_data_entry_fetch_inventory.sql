-- ============================================================
-- Data Entry Agent — fetch_inventory column on de_runs.
--
-- Captures what was actually found per source during the fetch phase,
-- so the run detail UI can show "Context Found" — e.g.
--   Salesforce Account: 1 record
--   Gong transcripts:   3 calls
--   Outreach mailings:  0
--   Gong calls (SF):    error — fetch failed (ENOTFOUND)
--
-- Shape:
--   [ { source, status: 'ok'|'empty'|'error', count, error? } ]
-- ============================================================

ALTER TABLE public.de_runs
  ADD COLUMN IF NOT EXISTS fetch_inventory jsonb;
