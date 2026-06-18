/**
 * POST /api/data-entry/prompts/[id] — Activate / roll back to a prompt version.
 *
 * The [id] is a single config.prompt_versions slot-row id. We resolve its
 * version, then for this agent (AGENT_REF) deactivate every slot and activate
 * BOTH slots (system + extraction) at that version, so the active prompt is a
 * consistent pair. Returns the now-active merged version in the legacy
 * `{ prompt }` shape the history view expects.
 *
 * Pattern matches Next.js dynamic segment; the UI calls this for rollback.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';
import {
  AGENT_REF,
  jsonError,
  mergePromptVersions,
  type PromptSlotRow,
} from '@/lib/revops/mappers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) return jsonError('Unauthorized', 401, 'UNAUTHORIZED');
  if (!ctx.permissions.modules.data_entry.can_edit_prompts) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const supabase = createServiceClient();

  // 1. Resolve the target version from the slot-row id (scoped to this agent).
  const { data: target, error: lookupErr } = await supabase
    .from('config.prompt_versions')
    .select('version')
    .eq('id', id)
    .eq('agent_ref', AGENT_REF)
    .maybeSingle();

  if (lookupErr) {
    return jsonError(lookupErr.message, 500, 'QUERY_FAILED');
  }
  if (!target) {
    return jsonError('Prompt not found', 404, 'NOT_FOUND');
  }

  const version = target.version as number;

  // 2. Deactivate every slot for this agent.
  const { error: deactErr } = await supabase
    .from('config.prompt_versions')
    .update({ is_active: false })
    .eq('agent_ref', AGENT_REF);

  if (deactErr) {
    return jsonError(deactErr.message, 500, 'DEACTIVATE_FAILED');
  }

  // 3. Activate both slots at the resolved version.
  const { error: actErr } = await supabase
    .from('config.prompt_versions')
    .update({ is_active: true })
    .eq('agent_ref', AGENT_REF)
    .eq('version', version);

  if (actErr) {
    return jsonError(actErr.message, 500, 'ACTIVATE_FAILED');
  }

  // 4. Read back both slot-rows at that version and merge into the UI shape.
  const { data: rows, error: readErr } = await supabase
    .from('config.prompt_versions')
    .select('id, slot, version, body, is_active, notes, created_at')
    .eq('agent_ref', AGENT_REF)
    .eq('version', version);

  if (readErr) {
    return jsonError(readErr.message, 500, 'QUERY_FAILED');
  }

  const merged = mergePromptVersions((rows ?? []) as PromptSlotRow[]);
  const prompt = merged[0] ?? null;
  if (!prompt) {
    return jsonError('Prompt not found', 404, 'NOT_FOUND');
  }

  return NextResponse.json({ prompt });
}
