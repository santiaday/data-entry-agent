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
import { AGENT_REF, jsonError, mapRun, extractionCounts } from '@/lib/revops/mappers';
import { revopsQuery, RemoteSqlError } from '@/lib/revops/sql-client';
import { withRevops } from '@/lib/revops/with-revops';

export const runtime = 'nodejs';

const MAX_RUNS = 50;

type ExtractionRollupRow = {
  run_id: string;
  write_outcome: string | null;
  dry_run: boolean | null;
};

/** Map a runs.agent_runs row into the BatchListItem shape the dashboard renders. */
function mapRunToBatch(
  row: Record<string, unknown>,
  counts?: ReturnType<typeof extractionCounts>,
) {
  const run = mapRun(row, counts);
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

export const GET = withRevops(async (request: Request) => {
  const ctx = await getAuthContext();
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
    console.error('[batches GET] query error:', error.code, error.message);
    return jsonError('Failed to load run history', 500, 'QUERY_FAILED');
  }

  const runRows = (data ?? []) as Record<string, unknown>[];
  const runIds = runRows
    .map((r) => r.run_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  // Roll up field_extractions per run so the history list reports real field
  // counts and the authoritative dry_run flag (Salesforce-triggered runs carry
  // no dry_run key in trigger_payload, so reading it alone mislabels them LIVE).
  const countsByRun = new Map<string, ReturnType<typeof extractionCounts>>();
  if (runIds.length > 0) {
    try {
      const extractionRows = await revopsQuery<ExtractionRollupRow>(
        `SELECT fe.run_id, fe.write_outcome, fe.dry_run
           FROM runs.field_extractions fe
          WHERE fe.agent_ref = $1 AND fe.run_id = ANY($2)`,
        [AGENT_REF, runIds],
      );
      const grouped = new Map<string, ExtractionRollupRow[]>();
      for (const eRow of extractionRows) {
        const existing = grouped.get(eRow.run_id);
        if (existing) existing.push(eRow);
        else grouped.set(eRow.run_id, [eRow]);
      }
      for (const [runId, rows] of grouped) {
        countsByRun.set(runId, extractionCounts(rows));
      }
    } catch (e) {
      // Best-effort enrichment: never fail the history list over a rollup error.
      const detail = e instanceof RemoteSqlError ? `${e.code ?? ''} ${e.message}` : String(e);
      console.error('[batches GET] extraction rollup failed:', detail);
    }
  }

  const batches = runRows.map((row) =>
    mapRunToBatch(row, countsByRun.get(row.run_id as string)),
  );

  return NextResponse.json({ batches });
});
