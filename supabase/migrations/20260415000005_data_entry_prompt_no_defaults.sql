-- ============================================================
-- Data Entry Agent — prompt update: stop defaulting to 0/false/None
-- when the LLM has no evidence.
--
-- Reads the currently-active prompt, appends new rules, inserts as a
-- new version, marks new version active and old version inactive.
-- Idempotent (won't double-append) via name-collision check.
-- ============================================================

DO $$
DECLARE
  v_org_id uuid := '00000000-0000-0000-0000-000000000001';
  v_current_prompt text;
  v_current_preamble text;
  v_next_version integer;
  v_addendum text := E'\n\nADDITIONAL RULES (default-value suppression):\n' ||
    '11. Score fields (any field ending in _Score__c): if you have no direct evidence of the score in the context, return null. Do NOT default to 0. A null score means "I don''t know"; a 0 score means "I know it''s zero" — these are different.\n' ||
    '12. Picklist fields with conservative-looking defaults (e.g. "None" for AI_Discount_Discussed__c, "Standard" for any complexity field): return null when there is no evidence in the context that the topic was discussed. Only use a default-looking value if the source explicitly indicates it (e.g. "no discount mentioned" → "None").\n' ||
    '13. Boolean fields: only return false when the context explicitly indicates the negative case (e.g. "AI was not demoed"). When the topic was simply not discussed, return null.\n' ||
    '14. Confidence calibration: if you''re returning a value at "low" confidence (40%) AND that value is a default (0, false, "None", "Standard"), prefer null instead — you''re not confident enough to overwrite or set a default.';
  v_already_applied boolean;
BEGIN
  -- Idempotency guard: skip if a prompt version with this exact note already exists
  SELECT EXISTS (
    SELECT 1 FROM public.de_prompts
     WHERE org_id = v_org_id
       AND name = 'No-defaulting rules'
  ) INTO v_already_applied;

  IF v_already_applied THEN
    RAISE NOTICE 'No-defaulting prompt rules already applied for org %, skipping.', v_org_id;
    RETURN;
  END IF;

  -- Read the currently-active prompt (handles case where user has edited v1)
  SELECT system_prompt, user_prompt_preamble
    INTO v_current_prompt, v_current_preamble
    FROM public.de_prompts
   WHERE org_id = v_org_id
     AND is_active = true
   LIMIT 1;

  IF v_current_prompt IS NULL THEN
    -- Local-dev tweak: original prod migration RAISE EXCEPTION'd here, but
    -- on a fresh local DB no prompt has been seeded yet (the app seeds v1
    -- on first run from EXTRACTION_SYSTEM_PROMPT). Make this a no-op so
    -- `supabase db reset` succeeds. Re-run this block manually after the
    -- app has seeded v1 if you want rules 11-14 baked into a v2.
    RAISE NOTICE 'No active prompt for org %. Skipping (app will seed v1 on first batch run).', v_org_id;
    RETURN;
  END IF;

  -- Compute next version
  SELECT COALESCE(MAX(version), 0) + 1
    INTO v_next_version
    FROM public.de_prompts
   WHERE org_id = v_org_id;

  -- Deactivate current
  UPDATE public.de_prompts
     SET is_active = false
   WHERE org_id = v_org_id
     AND is_active = true;

  -- Insert new active version with addendum
  INSERT INTO public.de_prompts (
    org_id, version, name, notes,
    system_prompt, user_prompt_preamble, is_active
  )
  VALUES (
    v_org_id,
    v_next_version,
    'No-defaulting rules',
    'Suppress 0/false/None defaults when the LLM has no evidence — prevents low-confidence noise from polluting AI_*_Score and similar fields across bulk runs.',
    v_current_prompt || v_addendum,
    COALESCE(v_current_preamble, ''),
    true
  );

  RAISE NOTICE 'Created prompt v% with no-defaulting rules and activated it.', v_next_version;
END $$;
