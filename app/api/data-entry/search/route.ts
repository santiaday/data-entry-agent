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
import { AGENT_REF, jsonError, mapRun } from '@/lib/revops/mappers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx.permissions.modules.data_entry.access) {
    return jsonError('Forbidden', 403);
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
    return jsonError(error.message, 500, 'QUERY_FAILED');
  }

  const runs = (data ?? []).map((row) => mapRun(row));

  return NextResponse.json({ runs });
}
