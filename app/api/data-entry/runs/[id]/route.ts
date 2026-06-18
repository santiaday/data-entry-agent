/**
 * GET /api/data-entry/runs/[id] — Get run detail with all extractions.
 *
 * Assembles a run detail from runs.agent_runs + runs.field_extractions.
 * Pipeline-only diagnostics (performance / fetch inventory / write results)
 * are no longer captured by the UI surface, so they are returned as
 * null/[] to keep the client-facing shape stable without fabricating data.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';
import { AGENT_REF, jsonError, mapRun, mapExtraction, extractionCounts } from '@/lib/revops/mappers';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const ctx = await getAuthContext();
  if (!ctx) return jsonError('Unauthorized', 401, 'UNAUTHORIZED');
  if (!ctx.permissions.modules.data_entry.access) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const supabase = createServiceClient();

  const [runRes, extractionsRes] = await Promise.all([
    supabase
      .from('runs.agent_runs')
      .select('*')
      .eq('run_id', id)
      .eq('agent_ref', AGENT_REF) // scope: never disclose another agent's run by id
      .maybeSingle(),
    supabase
      .from('runs.field_extractions')
      .select('*')
      .eq('run_id', id)
      .eq('agent_ref', AGENT_REF)
      .order('created_at', { ascending: true }),
  ]);

  if (runRes.error) {
    return jsonError(runRes.error.message, 500, 'QUERY_FAILED');
  }

  if (!runRes.data) {
    return jsonError('Run not found', 404, 'NOT_FOUND');
  }

  if (extractionsRes.error) {
    return jsonError(extractionsRes.error.message, 500, 'QUERY_FAILED');
  }

  const extractionRows = (extractionsRes.data ?? []) as Record<string, unknown>[];
  const extractions = extractionRows.map((row) => mapExtraction(row));
  const counts = extractionCounts(extractionRows);

  // Per-batch (group_key) rollup the UI shows alongside the run.
  const batchSummary: Record<string, { total: number; written: number; skipped: number; errored: number }> = {};
  for (const ext of extractions) {
    const key = ext.batch_id ?? '';
    if (!batchSummary[key]) {
      batchSummary[key] = { total: 0, written: 0, skipped: 0, errored: 0 };
    }
    batchSummary[key].total++;
    if (ext.was_written) batchSummary[key].written++;
    else if (ext.validation_errors && ext.validation_errors.length > 0) batchSummary[key].errored++;
    else if (ext.skip_reason) batchSummary[key].skipped++;
  }

  // mapRun supplies the RunListItem core; the detail view also reads a set of
  // pipeline-only diagnostic fields. Those are no longer produced by the UI
  // surface, so expose stable empty defaults rather than fabricated data.
  const run = {
    ...mapRun(runRes.data as Record<string, unknown>, counts),
    batch_id: (runRes.data as Record<string, unknown>).batch_id ?? null,
    fetch_errors: null,
    batch_errors: null,
    write_results: null,
    fetch_inventory: null,
    phase_timings: null,
    batch_executions: null,
    total_prompt_tokens: null,
    total_completion_tokens: null,
    de_batches: null,
  };

  return NextResponse.json({
    run,
    extractions,
    batchSummary,
  });
}
