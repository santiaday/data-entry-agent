/**
 * GET /api/data-entry/batches — Recent activity as batch-like history items.
 *
 * "Batches" (the old de_batches run-groups) are not a first-class concept in
 * the revops-backed schema — there is no de_batches table. The dashboard's
 * history list still expects `{ batches: BatchListItem[] }` and renders each
 * item as a `kind: 'batch'` row, so we surface the most recent runs.agent_runs
 * (last 50) for this agent mapped into the BatchListItem shape. Each run is a
 * single-record "batch" (total_records = 1); counts are derived from the run's
 * own status rather than fabricated. Run-level detail remains at /runs/[id].
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';
import { AGENT_REF, jsonError, mapRun } from '@/lib/revops/mappers';

export const runtime = 'nodejs';

const MAX_RUNS = 50;

/** Map a runs.agent_runs row into the BatchListItem shape the dashboard renders. */
function mapRunToBatch(row: Record<string, unknown>) {
  const run = mapRun(row);
  const isFailed = run.status === 'failed';
  const isComplete = run.status === 'completed';
  return {
    id: run.id,
    trigger_type: (row.trigger_kind as string) ?? 'manual',
    soql_query: null,
    object_type: run.object_type ?? '',
    dry_run: run.dry_run,
    status: run.status,
    total_records: 1,
    completed_records: isComplete ? 1 : 0,
    failed_records: isFailed ? 1 : 0,
    started_at: run.started_at,
    completed_at: run.completed_at,
    error: run.error,
    created_at: run.created_at,
  };
}

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return jsonError('Unauthorized', 401, 'UNAUTHORIZED');
  if (!ctx.permissions.modules.data_entry.access) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), MAX_RUNS);
  const status = searchParams.get('status');
  const triggerType = searchParams.get('trigger_type');

  const supabase = createServiceClient();

  let query = supabase
    .from('runs.agent_runs')
    .select('*')
    .eq('agent_ref', AGENT_REF)
    .order('started_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (triggerType) query = query.eq('trigger_kind', triggerType);

  const { data, error } = await query;

  if (error) {
    return jsonError(error.message, 500, 'QUERY_FAILED');
  }

  const batches = ((data ?? []) as Record<string, unknown>[]).map(mapRunToBatch);

  return NextResponse.json({ batches });
}
