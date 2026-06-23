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
import { withRevops } from '@/lib/revops/with-revops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withRevops(async () => {
  const ctx = await getAuthContext();
  const dePerms = ctx.permissions.modules.data_entry;
  if (!dePerms.access || !dePerms.can_run_batches) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  // A throw here (missing REVOPS env / unreachable endpoint) propagates to
  // withRevops, which renders a structured 503 the UI can show.
  const rows = await revopsQuery<{ id: string }>(
    `UPDATE runs.dispatch_queue
        SET enqueued_at = now()
      WHERE agent_ref = $1
        AND status = 'pending'
    RETURNING id`,
    [AGENT_REF],
  );
  const requeued = rows.length;

  return Response.json({
    ok: true,
    note: 'Queue is drained automatically by revops-agents; rows will dispatch shortly.',
    requeued,
  });
});
