/**
 * GET /api/data-entry/queue — List queued webhook records.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.permissions.modules.data_entry.access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10), 100);
  const status = searchParams.get('status');
  const recordId = searchParams.get('recordId');

  const supabase = createServiceClient();

  let query = supabase
    .from('data_entry_queue')
    .select('id, record_id, object_type, trigger_event, scheduled_at, status, attempts, max_attempts, last_error, run_id, delay_minutes, created_at, processed_at')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (recordId) {
    // Salesforce IDs are 15 or 18 chars — the 15-char version is always a
    // prefix of the 18-char version, so use a prefix match.
    query = query.like('record_id', `${recordId}%`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message, code: 'QUERY_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ queue: data ?? [] });
}
