/**
 * POST /api/data-entry/prompts/[id]/activate — Set this version as active,
 * deactivating any currently active version. Used for rolling back to a
 * previous version from the history view.
 *
 * Pattern matches Next.js dynamic segment; we handle "activate" via the
 * URL suffix checked in code.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.permissions.modules.data_entry.can_edit_prompts) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const supabase = createServiceClient();

  // Deactivate all, then activate the target
  const { error: deactErr } = await supabase
    .from('de_prompts')
    .update({ is_active: false })
    .eq('org_id', ctx.orgId)
    .eq('is_active', true);

  if (deactErr) {
    return NextResponse.json({ error: deactErr.message, code: 'DEACTIVATE_FAILED' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('de_prompts')
    .update({ is_active: true })
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? 'Prompt not found', code: 'ACTIVATE_FAILED' },
      { status: error ? 500 : 404 },
    );
  }

  return NextResponse.json({ prompt: data });
}
