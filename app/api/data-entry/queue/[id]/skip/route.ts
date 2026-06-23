/**
 * POST /api/data-entry/queue/[id]/skip — "Process now" for a queued record.
 *
 * In the new model the revops-agents cron-driver drains runs.dispatch_queue;
 * the UI never executes the pipeline. "Process now" simply re-queues the row
 * (status='pending', attempts reset) with a fresh enqueued_at so the next
 * drain picks it up immediately. Requires can_run_batches.
 */

import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';
import { AGENT_REF, jsonError } from '@/lib/revops/mappers';
import { withRevops, mapDbWriteError } from '@/lib/revops/with-revops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withRevops(async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  const ctx = await getAuthContext();
  if (!ctx.permissions.modules.data_entry.access) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }
  if (!ctx.permissions.modules.data_entry.can_run_batches) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const supabase = createServiceClient();

  // Re-queue the row for immediate pickup by the cron-driver's next drain.
  const { data, error } = await supabase
    .from('runs.dispatch_queue')
    .update({
      status: 'pending',
      attempts: 0,
      enqueued_at: new Date().toISOString(),
    })
    .eq('agent_ref', AGENT_REF)
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    return mapDbWriteError(
      error,
      'That queue item already exists',
      'Failed to re-queue the item',
      'UPDATE_FAILED',
    );
  }
  if (!data) {
    return jsonError('Queue item not found', 404, 'NOT_FOUND');
  }

  return Response.json({ ok: true, id: String(data.id) });
});
