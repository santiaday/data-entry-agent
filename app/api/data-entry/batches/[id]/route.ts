/**
 * GET /api/data-entry/batches/[id] — Get batch detail with per-record statuses.
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

  const [batchRes, runsRes] = await Promise.all([
    supabase
      .from('de_batches')
      .select('*')
      .eq('id', id)
      .eq('org_id', ctx.orgId)
      .maybeSingle(),
    supabase
      .from('de_runs')
      .select('id, record_id, object_type, status, dry_run, fields_extracted, fields_written, fields_skipped, fields_errored, duration_ms, started_at, completed_at, error, created_at')
      .eq('batch_id', id)
      .eq('org_id', ctx.orgId)
      .order('created_at', { ascending: true }),
  ]);

  if (batchRes.error) {
    return NextResponse.json({ error: batchRes.error.message, code: 'QUERY_FAILED' }, { status: 500 });
  }

  if (!batchRes.data) {
    return NextResponse.json({ error: 'Batch not found', code: 'NOT_FOUND' }, { status: 404 });
  }

  // Compute aggregate stats
  const runs = runsRes.data ?? [];
  const stats = {
    totalFields: runs.reduce((sum, r) => sum + (r.fields_extracted ?? 0), 0),
    totalWritten: runs.reduce((sum, r) => sum + (r.fields_written ?? 0), 0),
    totalSkipped: runs.reduce((sum, r) => sum + (r.fields_skipped ?? 0), 0),
    totalErrored: runs.reduce((sum, r) => sum + (r.fields_errored ?? 0), 0),
  };

  return NextResponse.json({
    batch: batchRes.data,
    runs,
    stats,
  });
}
