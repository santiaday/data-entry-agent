/**
 * GET  /api/data-entry/prompts — Active prompt + version history.
 * POST /api/data-entry/prompts — Create a new version; deactivates the prior
 *        active version for both slots and inserts a new system/extraction pair.
 *
 * Backed by config.prompt_versions (two rows per version):
 *   slot 'system'     ↔ system_prompt
 *   slot 'extraction' ↔ user_prompt_preamble
 * scoped by agent_ref = AGENT_REF.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
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

const SLOT_COLUMNS = 'id, slot, version, body, is_active, notes, created_at';

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx.email) return jsonError('Unauthorized', 401, 'UNAUTHORIZED');
  if (!ctx.permissions.modules.data_entry.access) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('config.prompt_versions')
    .select(SLOT_COLUMNS)
    .eq('agent_ref', AGENT_REF)
    .order('version', { ascending: false });

  if (error) {
    return jsonError(error.message, 500, 'QUERY_FAILED');
  }

  const rows = (data ?? []) as PromptSlotRow[];
  const versions = mergePromptVersions(rows);
  const active = versions.find((v) => v.is_active) ?? null;

  return NextResponse.json({
    active,
    history: versions,
  });
}

const createSchema = z.object({
  // The live PromptEditor client sends camelCase; the task spec names them in
  // snake_case. Accept both so neither contract breaks.
  systemPrompt: z.string().min(50).max(20_000).optional(),
  system_prompt: z.string().min(50).max(20_000).optional(),
  userPromptPreamble: z.string().max(5000).optional(),
  user_prompt_preamble: z.string().max(5000).optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx.email) return jsonError('Unauthorized', 401, 'UNAUTHORIZED');
  if (!ctx.permissions.modules.data_entry.can_edit_prompts) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400, 'INVALID_REQUEST');
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.message, 400, 'INVALID_REQUEST');
  }

  const systemPrompt = parsed.data.systemPrompt ?? parsed.data.system_prompt;
  const userPromptPreamble =
    parsed.data.userPromptPreamble ?? parsed.data.user_prompt_preamble ?? '';
  const notes = parsed.data.notes ?? null;

  if (!systemPrompt) {
    return jsonError('systemPrompt is required (50–20000 chars)', 400, 'INVALID_REQUEST');
  }

  const supabase = createServiceClient();

  // Compute next version: max(version) + 1 across both slots for this agent.
  const { data: maxRow, error: maxErr } = await supabase
    .from('config.prompt_versions')
    .select('version')
    .eq('agent_ref', AGENT_REF)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxErr) {
    return jsonError(maxErr.message, 500, 'QUERY_FAILED');
  }

  const nextVersion = ((maxRow?.version as number | undefined) ?? 0) + 1;

  // Deactivate currently-active rows for BOTH slots.
  const { error: deactErr } = await supabase
    .from('config.prompt_versions')
    .update({ is_active: false })
    .eq('agent_ref', AGENT_REF)
    .eq('is_active', true);

  if (deactErr) {
    return jsonError(deactErr.message, 500, 'DEACTIVATE_FAILED');
  }

  // Insert the new system + extraction pair, both active.
  const { data: inserted, error: insertErr } = await supabase
    .from('config.prompt_versions')
    .insert([
      {
        agent_ref: AGENT_REF,
        slot: 'system',
        version: nextVersion,
        body: systemPrompt,
        is_active: true,
        notes,
        created_by: ctx.email,
      },
      {
        agent_ref: AGENT_REF,
        slot: 'extraction',
        version: nextVersion,
        body: userPromptPreamble,
        is_active: true,
        notes,
        created_by: ctx.email,
      },
    ])
    .select(SLOT_COLUMNS);

  if (insertErr) {
    return jsonError(insertErr.message, 500, 'CREATE_FAILED');
  }

  const newRows = (inserted ?? []) as PromptSlotRow[];
  const [prompt] = mergePromptVersions(newRows);

  return NextResponse.json({ prompt }, { status: 201 });
}
