/**
 * GET /api/data-entry/runs/[id] — Get run detail with all extractions.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.permissions.modules.data_entry.access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const supabase = createServiceClient();

  const [runRes, extractionsRes] = await Promise.all([
    supabase
      .from('de_runs')
      .select('*, de_batches!inner(trigger_type, soql_query, dry_run)')
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .maybeSingle(),
    supabase
      .from('de_extractions')
      .select('id, field_name, sf_object, batch_id, extracted_value, current_sf_value, write_mode, confidence, evidence, was_written, skip_reason, validation_errors, created_at')
      .eq('run_id', id)
      .eq('org_id', ctx.orgId)
      .order('batch_id', { ascending: true })
      .order('field_name', { ascending: true }),
  ]);

  if (runRes.error) {
    return NextResponse.json({ error: runRes.error.message, code: 'QUERY_FAILED' }, { status: 500 });
  }

  if (!runRes.data) {
    return NextResponse.json({ error: 'Run not found', code: 'NOT_FOUND' }, { status: 404 });
  }

  // Compute summary stats by batch
  const extractions = extractionsRes.data ?? [];
  const batchSummary = new Map<string, { total: number; written: number; skipped: number; errored: number }>();

  for (const ext of extractions) {
    const key = ext.batch_id;
    if (!batchSummary.has(key)) {
      batchSummary.set(key, { total: 0, written: 0, skipped: 0, errored: 0 });
    }
    const summary = batchSummary.get(key)!;
    summary.total++;
    if (ext.was_written) summary.written++;
    else if (ext.validation_errors && ext.validation_errors.length > 0) summary.errored++;
    else if (ext.skip_reason) summary.skipped++;
  }

  return NextResponse.json({
    run: runRes.data,
    extractions,
    batchSummary: Object.fromEntries(batchSummary),
  });
}
