/**
 * GET /api/data-entry/search?recordId=XXX
 *
 * Returns all de_runs rows touching a given Salesforce record ID, ordered by
 * most recent first. Used by the /data-entry/search page so users can trace
 * the full history of what the agent did to any specific Lead/Opp.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.permissions.modules.data_entry.access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const recordId = searchParams.get('recordId')?.trim() ?? '';

  if (recordId.length < 3) {
    return NextResponse.json({ runs: [] });
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('de_runs')
    .select('id, batch_id, record_id, object_type, status, dry_run, fields_extracted, fields_written, fields_skipped, fields_errored, duration_ms, started_at, completed_at, error, created_at')
    .eq('org_id', ctx.orgId)
    .like('record_id', `${recordId}%`)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message, code: 'QUERY_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ runs: data ?? [] });
}
