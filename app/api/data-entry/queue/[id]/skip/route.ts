/**
 * POST /api/data-entry/queue/[id]/skip — Process a queued record immediately.
 *
 * Runs the full data entry pipeline inline (same as Quick Run), then marks
 * the queue item as completed. No waiting for the cron tick.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';
import { SalesforceTokenCache } from '@/lib/sf';
import { runPipeline } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const maxDuration = 300;

const tokenCache = new SalesforceTokenCache();

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dePerms = ctx.permissions.modules.data_entry;
  if (!dePerms.access || !dePerms.can_run_batches) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const supabase = createServiceClient();

  // Load the queue item
  const { data: item, error: fetchErr } = await supabase
    .from('data_entry_queue')
    .select('id, record_id, object_type, status, org_id')
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .maybeSingle();

  if (fetchErr || !item) {
    return NextResponse.json({ error: 'Queue item not found' }, { status: 404 });
  }

  if (item.status !== 'waiting') {
    return NextResponse.json(
      { error: `Cannot process — status is '${item.status}', expected 'waiting'` },
      { status: 409 },
    );
  }

  // Mark as processing
  await supabase
    .from('data_entry_queue')
    .update({ status: 'processing' })
    .eq('id', id);

  try {
    const result = await runPipeline({
      input: {
        recordId: item.record_id,
        objectType: item.object_type as 'Lead' | 'Opportunity',
        orgId: ctx.orgId,
        userId: ctx.userId,
        dryRun: false,
      },
      supabase,
      tokenCache,
      triggerType: 'webhook',
    });

    // Mark queue item completed
    await supabase
      .from('data_entry_queue')
      .update({
        status: 'completed',
        run_id: result.runId,
        attempts: 1,
        processed_at: new Date().toISOString(),
      })
      .eq('id', id);

    return NextResponse.json({
      processed: true,
      runId: result.runId,
      fieldsWritten: result.fieldsWritten,
      fieldsSkipped: result.fieldsSkipped,
      fieldsErrored: result.fieldsErrored,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabase
      .from('data_entry_queue')
      .update({
        status: 'failed',
        attempts: 1,
        last_error: message,
      })
      .eq('id', id);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
