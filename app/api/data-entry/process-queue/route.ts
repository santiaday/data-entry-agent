/**
 * GET /api/data-entry/process-queue — Cron-triggered queue processor.
 *
 * Vercel cron hits this every 5 minutes. It finds queued records whose
 * scheduled_at has passed and runs the full data entry pipeline for each.
 *
 * With Vercel Pro's 300s timeout, we process up to 2 records per invocation
 * (each pipeline run takes ~1-3 minutes).
 */

import { NextResponse } from 'next/server';
import { DEFAULT_ORG_ID } from '@/lib/constants';
import { createServiceClient } from '@/lib/supabase/server';
import { SalesforceTokenCache } from '@/lib/sf';
import { runPipeline } from '@/lib/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Vercel Pro: 5 minutes

const tokenCache = new SalesforceTokenCache();

/**
 * Max records to process per cron tick. These run in parallel so the
 * wall-clock time is roughly that of the slowest single pipeline run
 * (~30s), not N × 30s. 10 keeps us well within the 300s timeout.
 */
const MAX_PER_TICK = 10;

export async function GET(request: Request) {
  // ── Auth: Vercel cron secret ────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  // ── Claim ready jobs ────────────────────────────────────────
  // Find waiting jobs whose delay has elapsed, ordered by scheduled time.
  const { data: jobs, error: fetchErr } = await supabase
    .from('data_entry_queue')
    .select('id, record_id, object_type, trigger_event, attempts')
    .eq('org_id', DEFAULT_ORG_ID)
    .eq('status', 'waiting')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(MAX_PER_TICK);

  if (fetchErr) {
    console.error('[process-queue] Failed to fetch jobs:', fetchErr.message);
    return NextResponse.json({ error: 'Failed to fetch queue' }, { status: 500 });
  }

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ processed: 0, message: 'No jobs ready' });
  }

  // Mark claimed jobs as 'processing' to prevent double-pickup
  const jobIds = jobs.map((j) => j.id as string);
  await supabase
    .from('data_entry_queue')
    .update({ status: 'processing' })
    .in('id', jobIds);

  // ── Process jobs in parallel ─────────────────────────────────
  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      const jobId = job.id as string;
      const recordId = job.record_id as string;
      const objectType = job.object_type as 'Lead' | 'Opportunity';
      const attempts = (job.attempts as number) + 1;

      try {
        console.log(`[process-queue] Processing ${objectType} ${recordId} (attempt ${attempts})`);

        const result = await runPipeline({
          input: {
            recordId,
            objectType,
            orgId: DEFAULT_ORG_ID,
            userId: null,
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

        console.log(
          `[process-queue] Completed ${objectType} ${recordId}: ` +
          `${result.fieldsWritten} written, ${result.fieldsSkipped} skipped`,
        );

        return { jobId, recordId, status: 'completed' as const, runId: result.runId };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[process-queue] Failed ${objectType} ${recordId}:`, message);

        const maxAttempts = (job as Record<string, unknown>).max_attempts as number | undefined ?? 3;
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

  const succeeded = results.filter((r) => r.status === 'completed').length;
  const failed = results.filter((r) => r.status === 'failed').length;

  console.log(`[process-queue] Tick complete: ${succeeded} succeeded, ${failed} failed`);

  return NextResponse.json({
    processed: results.length,
    succeeded,
    failed,
    results,
  });
}
