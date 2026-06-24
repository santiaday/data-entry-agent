/**
 * GET /api/data-entry/search?recordId=XXX
 *
 * Returns all agent runs touching a given Salesforce record ID (prefix match),
 * ordered by most recent first. Used by the /data-entry/search page so users
 * can trace the full history of what the agent did to any specific Lead/Opp.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';
import { AGENT_REF, jsonError, mapRun, extractionCounts } from '@/lib/revops/mappers';
import { revopsQuery, RemoteSqlError } from '@/lib/revops/sql-client';
import { withRevops } from '@/lib/revops/with-revops';

type ExtractionRollupRow = {
  run_id: string;
  write_outcome: string | null;
  dry_run: boolean | null;
};

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withRevops(async (request: Request) => {
  const ctx = await getAuthContext();
  if (!ctx.permissions.modules.data_entry.access) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const { searchParams } = new URL(request.url);
  const recordId = searchParams.get('recordId')?.trim() ?? '';

  if (recordId.length < 3) {
    return NextResponse.json({ runs: [] });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('runs.agent_runs')
    .select(
      'run_id, agent_ref, subject_id, subject_kind, status, trigger_payload, duration_ms, started_at, ended_at, error, created_at',
    )
    .like('subject_id', `${recordId}%`)
    .eq('agent_ref', AGENT_REF)
    .order('started_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[search GET] query error:', error.code, error.message);
    return jsonError('Failed to search runs', 500, 'QUERY_FAILED');
  }

  const runRows = data ?? [];
  const runIds = runRows.map((r) => r.run_id).filter((id): id is string => !!id);

  // Roll up field_extractions per run so each search card shows real
  // extracted/written/skipped counts AND the authoritative dry_run flag
  // (trigger_payload.dry_run is absent on Salesforce-triggered runs).
  const countsByRun = new Map<string, ReturnType<typeof extractionCounts>>();
  if (runIds.length > 0) {
    try {
      const extractionRows = await revopsQuery<ExtractionRollupRow>(
        `SELECT fe.run_id, fe.write_outcome, fe.dry_run
           FROM runs.field_extractions fe
          WHERE fe.agent_ref = $1 AND fe.run_id::text = ANY($2)`,
        [AGENT_REF, runIds],
      );
      const grouped = new Map<string, ExtractionRollupRow[]>();
      for (const row of extractionRows) {
        const existing = grouped.get(row.run_id);
        if (existing) existing.push(row);
        else grouped.set(row.run_id, [row]);
      }
      for (const [runId, rows] of grouped) {
        countsByRun.set(runId, extractionCounts(rows));
      }
    } catch (e) {
      // Counts are best-effort enrichment; a rollup failure must not break the
      // search list. Log and fall through to the trigger-payload dry_run default.
      const detail = e instanceof RemoteSqlError ? `${e.code ?? ''} ${e.message}` : String(e);
      console.error('[search GET] extraction rollup failed:', detail);
    }
  }

  const runs = runRows.map((row) => mapRun(row, countsByRun.get(row.run_id)));

  return NextResponse.json({ runs });
});
