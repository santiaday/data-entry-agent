/**
 * Load the active system prompt from the database, seeding from the
 * code default on first run per-org.
 *
 * Every UI save creates a new version and flips is_active; runtime
 * always uses whichever version has is_active = true.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { EXTRACTION_SYSTEM_PROMPT } from '../extract/prompt-builder';

export type ActivePrompt = {
  id: string;
  version: number;
  systemPrompt: string;
  userPromptPreamble: string;
};

/**
 * Load the active system prompt for an org.
 * Returns the prompt string directly (most callers just need that).
 * If no active prompt exists, seeds the code default as version 1.
 */
export async function loadActivePrompt(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string> {
  const row = await loadActivePromptRow(supabase, orgId);
  return row.systemPrompt;
}

/** Same as loadActivePrompt but returns the full row. */
export async function loadActivePromptRow(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ActivePrompt> {
  const { data, error } = await supabase
    .from('de_prompts')
    .select('id, version, system_prompt, user_prompt_preamble')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load active prompt: ${error.message}`);
  }

  if (data) {
    return {
      id: data.id as string,
      version: data.version as number,
      systemPrompt: data.system_prompt as string,
      userPromptPreamble: (data.user_prompt_preamble as string) ?? '',
    };
  }

  // No active prompt — seed from code and retry
  console.log(`[data-entry] Seeding default prompt (v1) for org ${orgId}`);
  await seedDefaultPrompt(supabase, orgId);
  return loadActivePromptRow(supabase, orgId);
}

/**
 * Seed the code-default prompt as version 1, is_active = true.
 * Idempotent via UNIQUE(org_id, version).
 */
export async function seedDefaultPrompt(
  supabase: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { error } = await supabase.from('de_prompts').upsert(
    {
      org_id: orgId,
      version: 1,
      name: 'Code default',
      notes: 'Seeded automatically from EXTRACTION_SYSTEM_PROMPT on first run.',
      system_prompt: EXTRACTION_SYSTEM_PROMPT,
      user_prompt_preamble: '',
      is_active: true,
    },
    { onConflict: 'org_id,version', ignoreDuplicates: true },
  );

  if (error) {
    throw new Error(`Failed to seed default prompt: ${error.message}`);
  }
}
