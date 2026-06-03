/**
 * POST /api/data-entry/queue/process-ready — Manual queue processor.
 *
 * Session-authenticated alternative to the cron-based process-queue.
 * Picks up to MAX_PER_TICK ready jobs and processes them sequentially.
 * Returns the results so the dashboard can show progress and re-trigger.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';
import { SalesforceTokenCache } from '@/lib/sf';
import { runPipeline } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const tokenCache = new SalesforceTokenCache();

/** Records run in parallel — 10 fits comfortably in the 300s timeout. */
const MAX_PER_TICK = 10;

export async function POST() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const dePerms = ctx.permissions.modules.data_entry;
  if (!dePerms.access || !dePerms.can_run_batches) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const supabase = createServiceClient();

  // Find waiting jobs whose delay has elapsed
  const { data: jobs, error: fetchErr } = await supabase
    .from('data_entry_queue')
    .select('id, record_id, object_type, trigger_event, attempts, max_attempts')
    .eq('org_id', ctx.orgId)
    .eq('status', 'waiting')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MAX_PER_TICK);

  if (fetchErr) {
    return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 });
  }

  if (!jobs || jobs.length === 0) {
    // Count remaining (not yet ready)
    const { count } = await supabase
      .from('data_entry_queue')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', ctx.orgId)
      .eq('status', 'waiting')
      .gt('scheduled_at', new Date().toISOString());

    return NextResponse.json({
      processed: 0,
      succeeded: 0,
      failed: 0,
      remaining: count ?? 0,
      message: 'No jobs ready',
    });
  }

  // Mark claimed jobs as processing
  const jobIds = jobs.map((j) => j.id as string);
  await supabase
    .from('data_entry_queue')
    .update({ status: 'processing' })
    .in('id', jobIds);

  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      const jobId = job.id as string;
      const recordId = job.record_id as string;
      const objectType = job.object_type as 'Lead' | 'Opportunity';
      const attempts = (job.attempts as number) + 1;

      try {
        const result = await runPipeline({
          input: {
            recordId,
            objectType,
            orgId: ctx.orgId,
            userId: ctx.userId,
            dryRun: false,
          },
          supabase,
          tokenCache,
          triggerType: 'webhook',
        });

        await supabase
          .from('data_entry_queue')
          .update({
            status: 'completed',
            attempts,
            run_id: result.runId,
            processed_at: new Date().toISOString(),
          })
          .eq('id', jobId);

        return { jobId, recordId, status: 'completed' as const, runId: result.runId };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const maxAttempts = (job.max_attempts as number | null) ?? 3;
        const newStatus = attempts >= maxAttempts ? 'failed' : 'waiting';

        await supabase
          .from('data_entry_queue')
          .update({ status: newStatus, attempts, last_error: message })
          .eq('id', jobId);

        return { jobId, recordId, status: 'failed' as const, error: message };
      }
    }),
  );

  const results = settled.map((s) =>
    s.status === 'fulfilled'
      ? s.value
      : { jobId: 'unknown', recordId: 'unknown', status: 'failed' as const, error: String(s.reason) },
  );

  // Count remaining ready jobs so the dashboard knows whether to re-trigger
  const { count: remaining } = await supabase
    .from('data_entry_queue')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', ctx.orgId)
    .eq('status', 'waiting')
    .lte('scheduled_at', new Date().toISOString());

  return NextResponse.json({
    processed: results.length,
    succeeded: results.filter((r) => r.status === 'completed').length,
    failed: results.filter((r) => r.status === 'failed').length,
    remaining: remaining ?? 0,
    results,
  });
}
