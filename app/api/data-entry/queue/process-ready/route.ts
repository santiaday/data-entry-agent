/**
 * POST /api/data-entry/queue/process-ready — Re-queue pending dispatch rows.
 *
 * This used to be a manual "drain N ready" trigger that ran extraction inline.
 * The revops-agents cron-driver now drains runs.dispatch_queue automatically,
 * so this route no longer executes anything. It simply touches every 'pending'
 * row for this agent (enqueued_at = now()) so they are freshly ordered for the
 * next automatic dispatch tick, and reports how many rows were re-queued.
 */

import { getAuthContext } from '@/lib/auth';
import { AGENT_REF, jsonError } from '@/lib/revops/mappers';
import { revopsQuery } from '@/lib/revops/sql-client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) return jsonError('Unauthorized', 401);

  const dePerms = ctx.permissions.modules.data_entry;
  if (!dePerms.access || !dePerms.can_run_batches) {
    return jsonError('Forbidden', 403);
  }

  let requeued = 0;
  try {
    const rows = await revopsQuery<{ id: string }>(
      `UPDATE runs.dispatch_queue
          SET enqueued_at = now()
        WHERE agent_ref = $1
          AND status = 'pending'
      RETURNING id`,
      [AGENT_REF],
    );
    requeued = rows.length;
  } catch {
    return jsonError('Failed to re-queue pending rows', 500);
  }

  return Response.json({
    ok: true,
    note: 'Queue is drained automatically by revops-agents; rows will dispatch shortly.',
    requeued,
  });
}
