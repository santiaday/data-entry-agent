/**
 * GET /api/data-entry/batches — List recent batches.
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
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);
  const status = searchParams.get('status');
  const triggerType = searchParams.get('trigger_type');

  const supabase = createServiceClient();

  let query = supabase
    .from('de_batches')
    .select('id, trigger_type, soql_query, object_type, dry_run, status, total_records, completed_records, failed_records, started_at, completed_at, error, created_at')
    .eq('org_id', ctx.orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);
  if (triggerType) query = query.eq('trigger_type', triggerType);

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message, code: 'QUERY_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ batches: data ?? [] });
}
