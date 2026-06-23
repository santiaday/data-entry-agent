/**
 * GET /api/data-entry/queue — List queued dispatch records for this agent.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';
import { AGENT_REF, jsonError, mapQueue } from '@/lib/revops/mappers';
import { withRevops } from '@/lib/revops/with-revops';

export const runtime = 'nodejs';

export const GET = withRevops(async (request: Request) => {
  const ctx = await getAuthContext();
  if (!ctx.permissions.modules.data_entry.access) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
  const status = searchParams.get('status');
  const recordId = searchParams.get('recordId');

  const supabase = createServiceClient();

  let query = supabase
    .from('runs.dispatch_queue')
    .select(
      'id, subject_id, subject_kind, payload, enqueued_by, enqueued_at, status, attempts, max_attempts, last_error, dispatched_run_id, updated_at, dry_run',
    )
    .eq('agent_ref', AGENT_REF)
    .order('enqueued_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (recordId) {
    // Salesforce IDs are 15 or 18 chars — the 15-char version is always a
    // prefix of the 18-char version, so use a prefix match.
    query = query.like('subject_id', `${recordId}%`);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[queue GET] query error:', error.code, error.message);
    return jsonError('Failed to load the dispatch queue', 500, 'QUERY_FAILED');
  }

  return NextResponse.json({ queue: (data ?? []).map(mapQueue) });
});
