/**
 * GET  /api/data-entry/prompts — Active prompt + version history.
 * POST /api/data-entry/prompts — Create a new version; flips is_active.
 *        Body: { systemPrompt, userPromptPreamble?, name?, notes? }
 *        If activate=false, the new version is saved but doesn't become active.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadActivePromptRow } from '@/lib/pipeline';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.permissions.modules.data_entry.access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const supabase = createServiceClient();

  // Ensure a seed exists
  try {
    await loadActivePromptRow(supabase, ctx.orgId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Seed failed', code: 'SEED_FAILED' },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from('de_prompts')
    .select('id, version, name, notes, system_prompt, user_prompt_preamble, is_active, created_at')
    .eq('org_id', ctx.orgId)
    .order('version', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message, code: 'QUERY_FAILED' }, { status: 500 });
  }

  const rows = data ?? [];
  const active = rows.find((r) => r.is_active) ?? null;

  return NextResponse.json({
    active,
    history: rows,
  });
}

const createSchema = z.object({
  systemPrompt: z.string().min(50).max(20_000),
  userPromptPreamble: z.string().max(5000).optional().default(''),
  name: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  activate: z.boolean().optional().default(true),
});

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.permissions.modules.data_entry.can_edit_prompts) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message, code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const input = parsed.data;

  // Compute next version: max(version) + 1 for this org
  const { data: maxRow, error: maxErr } = await supabase
    .from('de_prompts')
    .select('version')
    .eq('org_id', ctx.orgId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (maxErr) {
    return NextResponse.json({ error: maxErr.message, code: 'QUERY_FAILED' }, { status: 500 });
  }

  const nextVersion = ((maxRow?.version as number | undefined) ?? 0) + 1;

  if (input.activate) {
    // Deactivate all existing active versions first
    const { error: deactErr } = await supabase
      .from('de_prompts')
      .update({ is_active: false })
      .eq('org_id', ctx.orgId)
      .eq('is_active', true);

    if (deactErr) {
      return NextResponse.json({ error: deactErr.message, code: 'DEACTIVATE_FAILED' }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from('de_prompts')
    .insert({
      org_id: ctx.orgId,
      user_id: ctx.userId,
      version: nextVersion,
      name: input.name ?? null,
      notes: input.notes ?? null,
      system_prompt: input.systemPrompt,
      user_prompt_preamble: input.userPromptPreamble,
      is_active: input.activate,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message, code: 'CREATE_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ prompt: data }, { status: 201 });
}
