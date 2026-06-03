/**
 * Backfill / single-record CLI for the Data Entry Agent.
 *
 * Usage (from the repo root):
 *   pnpm backfill -- --record-id 00Q... --object-type Lead --dry-run
 *   pnpm backfill -- --backfill-query "SELECT Id FROM Lead WHERE Status = 'Demo Completed'"
 *
 * Env is loaded from .env.local / .env at the repo root (see lib/pipeline/client.ts).
 */

import { SalesforceTokenCache, executeSoql } from '@/lib/sf';
import { supabase, ORG_ID } from '@/lib/pipeline/client';
import { runPipeline } from '@/lib/pipeline/run';
import { pMap } from '@/lib/pipeline/utils/concurrency';
import { createBatch, completeBatch } from '@/lib/pipeline/logging/run-logger';

// ── CLI entrypoint ──────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printUsage();
    process.exit(0);
  }

  const tokenCache = new SalesforceTokenCache();

  if (args.backfillQuery) {
    await runBackfill({
      query: args.backfillQuery,
      objectType: args.objectType,
      dryRun: args.dryRun,
      tokenCache,
      concurrency: args.concurrency,
      skipCompleted: args.skipCompleted,
    });
  } else if (args.recordId) {
    await runSingle({
      recordId: args.recordId,
      objectType: args.objectType,
      dryRun: args.dryRun,
      tokenCache,
    });
  } else {
    console.error('Error: --record-id or --backfill-query is required');
    printUsage();
    process.exit(1);
  }
}

// ── Single record mode ──────────────────────────────────────

async function runSingle(params: {
  recordId: string;
  objectType: 'Lead' | 'Opportunity';
  dryRun: boolean;
  tokenCache: SalesforceTokenCache;
}): Promise<void> {
  console.log(`\n[data-entry] Processing ${params.objectType} ${params.recordId}${params.dryRun ? ' (DRY RUN)' : ''}\n`);

  // Track timing locally — DO NOT reference `result` inside onEvent; it's
  // in the temporal dead zone until runPipeline resolves. Using `result`
  // there would silently fail the run even if all the real work succeeded.
  const runStart = Date.now();

  const result = await runPipeline({
    input: {
      recordId: params.recordId,
      objectType: params.objectType,
      orgId: ORG_ID,
      userId: null,
      dryRun: params.dryRun,
    },
    supabase,
    tokenCache: params.tokenCache,
    onEvent: (event) => {
      switch (event.type) {
        case 'phase':
          console.log(`  [${event.phase}] ${event.status}`);
          break;
        case 'fetch_result':
          console.log(`  [fetch] ${event.source}: ${event.ok ? 'ok' : `FAILED — ${event.error}`}`);
          break;
        case 'done':
          console.log(`\n  ✓ Done in ${Date.now() - runStart}ms`);
          console.log(`    Extracted: ${event.summary.extracted}`);
          console.log(`    Written:   ${event.summary.written}`);
          console.log(`    Skipped:   ${event.summary.skipped}`);
          console.log(`    Errors:    ${event.summary.errored}`);
          break;
        case 'error':
          console.error(`\n  ✗ Error: ${event.error}`);
          break;
      }
    },
  });

  if (result.status === 'failed') {
    process.exit(1);
  }
}

// ── Backfill mode ───────────────────────────────────────────

async function runBackfill(params: {
  query: string;
  objectType: 'Lead' | 'Opportunity';
  dryRun: boolean;
  tokenCache: SalesforceTokenCache;
  concurrency: number;
  skipCompleted: boolean;
}): Promise<void> {
  const startedAt = Date.now();

  console.log('');
  console.log('━'.repeat(72));
  console.log(`  Data Entry Agent — Backfill${params.dryRun ? ' (DRY RUN)' : ''}`);
  console.log('━'.repeat(72));
  console.log(`  Query:       ${params.query}`);
  console.log(`  Object:      ${params.objectType}`);
  console.log(`  Concurrency: ${params.concurrency}`);
  if (params.skipCompleted) {
    console.log(`  Skip done:   yes (resume mode — filters de_runs.status = 'completed')`);
  }
  console.log('');

  // Execute the query to get record IDs
  const queryResult = await executeSoql({
    query: params.query,
    orgId: ORG_ID,
    supabase,
    tokenCache: params.tokenCache,
  });

  let recordIds = queryResult.records.map((r) => r.Id as string);
  console.log(`  Found ${recordIds.length} record${recordIds.length === 1 ? '' : 's'} in Salesforce`);

  if (params.skipCompleted && recordIds.length > 0) {
    const alreadyDone = await loadCompletedRecordIds({
      objectType: params.objectType,
      dryRun: params.dryRun,
      candidateIds: recordIds,
    });
    if (alreadyDone.size > 0) {
      const before = recordIds.length;
      recordIds = recordIds.filter((id) => !alreadyDone.has(id));
      console.log(
        `  Skipping ${before - recordIds.length} already-completed record${
          before - recordIds.length === 1 ? '' : 's'
        } (from prior runs in de_runs)`,
      );
      console.log(`  Remaining:   ${recordIds.length}`);
    } else {
      console.log(`  No prior completed runs found for these records.`);
    }
  }

  if (recordIds.length === 0) {
    console.log('  Nothing to process. Exiting.\n');
    return;
  }

  // Create ONE parent batch for the whole backfill so the dashboard shows
  // a single grouped entry instead of N separate batches.
  const batchId = await createBatch({
    supabase,
    orgId: ORG_ID,
    userId: null,
    triggerType: 'cli',
    objectType: params.objectType,
    dryRun: params.dryRun,
    totalRecords: recordIds.length,
    soqlQuery: params.query,
  });

  console.log(`  Batch ID:    ${batchId}`);
  console.log(`  Monitor at:  ${getBatchUrl(batchId)}`);
  console.log('');

  let completed = 0;
  let failed = 0;
  let totalFieldsWritten = 0;
  let totalFieldsSkipped = 0;
  const recordDurations: number[] = [];

  await pMap(
    recordIds,
    async (recordId, index) => {
      const recordStart = Date.now();
      try {
        const result = await runPipeline({
          input: {
            recordId,
            objectType: params.objectType,
            orgId: ORG_ID,
            userId: null,
            dryRun: params.dryRun,
          },
          supabase,
          tokenCache: params.tokenCache,
          existingBatchId: batchId,
          triggerType: 'cli',
        });

        const recordMs = Date.now() - recordStart;
        recordDurations.push(recordMs);

        if (result.status === 'completed') {
          completed++;
          totalFieldsWritten += result.fieldsWritten;
          totalFieldsSkipped += result.fieldsSkipped;
        } else {
          failed++;
        }

        printRecordLine({
          index: index + 1,
          total: recordIds.length,
          recordId,
          status: result.status,
          fieldsWritten: result.fieldsWritten,
          fieldsSkipped: result.fieldsSkipped,
          fieldsErrored: result.fieldsErrored,
          durationMs: recordMs,
          error: result.error,
          startedAt,
          completed: completed + failed,
        });
      } catch (error) {
        failed++;
        recordDurations.push(Date.now() - recordStart);
        const message = error instanceof Error ? error.message : String(error);
        printRecordLine({
          index: index + 1,
          total: recordIds.length,
          recordId,
          status: 'failed',
          fieldsWritten: 0,
          fieldsSkipped: 0,
          fieldsErrored: 0,
          durationMs: Date.now() - recordStart,
          error: message,
          startedAt,
          completed: completed + failed,
        });
      }
    },
    params.concurrency,
  );

  // Final batch close-out with authoritative totals
  await completeBatch({
    supabase,
    batchId,
    completedRecords: completed,
    failedRecords: failed,
  });

  const totalMs = Date.now() - startedAt;
  const avgMs = recordDurations.length > 0
    ? Math.round(recordDurations.reduce((s, d) => s + d, 0) / recordDurations.length)
    : 0;

  console.log('');
  console.log('━'.repeat(72));
  console.log('  Backfill complete');
  console.log('━'.repeat(72));
  console.log(`  Records:       ${completed} succeeded · ${failed} failed · ${recordIds.length} total`);
  console.log(`  Fields:        ${totalFieldsWritten} written · ${totalFieldsSkipped} skipped`);
  console.log(`  Duration:      ${formatDuration(totalMs)} (avg ${formatDuration(avgMs)} per record)`);
  console.log(`  View results:  ${getBatchUrl(batchId)}`);
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

/**
 * Look up which of the candidate record IDs have already been fully processed
 * (status = 'completed') in a prior batch with the same dryRun mode. This
 * powers --skip-completed so a long backfill can be killed and resumed.
 *
 * Failed runs are NOT skipped — re-running them is the desired behavior.
 *
 * Implementation note: previously we sent the candidate set via .in(record_id, [...]),
 * but Supabase's REST API passes filter values in the URL query string, and a
 * large IN list (~500 SF Ids) overflows the URI cap and dies with "URI too long".
 * Instead we fetch ALL completed record_ids for this org+object+dry_run and do
 * the intersection in JS. The completed set even at 100k rows is ~2MB — trivial
 * to hold in memory, and a single query with a clean filter.
 */
async function loadCompletedRecordIds(params: {
  objectType: string;
  dryRun: boolean;
  candidateIds: readonly string[];
}): Promise<Set<string>> {
  const done = new Set<string>();
  if (params.candidateIds.length === 0) return done;

  // PostgREST default page size is 1000 rows. Page through until exhausted so
  // we capture the full completed history (no surprise truncation on big DBs).
  const PAGE = 1000;
  const candidateSet = new Set(params.candidateIds);
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('de_runs')
      .select('record_id')
      .eq('org_id', ORG_ID)
      .eq('object_type', params.objectType)
      .eq('dry_run', params.dryRun)
      .eq('status', 'completed')
      .order('record_id', { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) {
      console.warn(`[skip-completed] DB lookup failed (${error.message}); proceeding without skip filter.`);
      return new Set();
    }

    const rows = (data ?? []) as { record_id: string }[];
    for (const row of rows) {
      if (candidateSet.has(row.record_id)) done.add(row.record_id);
    }

    if (rows.length < PAGE) break;
    from += PAGE;
  }

  return done;
}

function printRecordLine(args: {
  index: number;
  total: number;
  recordId: string;
  status: 'completed' | 'failed';
  fieldsWritten: number;
  fieldsSkipped: number;
  fieldsErrored: number;
  durationMs: number;
  error?: string;
  startedAt: number;
  completed: number;
}): void {
  const icon = args.status === 'completed' ? '✓' : '✗';
  const counter = `[${String(args.index).padStart(String(args.total).length, ' ')}/${args.total}]`;
  const elapsed = Date.now() - args.startedAt;
  const avgPerRecord = args.completed > 0 ? elapsed / args.completed : args.durationMs;
  const remaining = args.total - args.completed;
  const eta = remaining * avgPerRecord;
  const pct = Math.round((args.completed / args.total) * 100);

  const summary = args.status === 'completed'
    ? `${args.fieldsWritten} written · ${args.fieldsSkipped} skipped${args.fieldsErrored > 0 ? ` · ${args.fieldsErrored} errored` : ''}`
    : `ERROR — ${args.error ?? 'unknown'}`;

  console.log(
    `  ${counter} ${icon} ${args.recordId}  (${formatDuration(args.durationMs)})  ${summary}`,
  );
  console.log(
    `         ${pct}% complete · elapsed ${formatDuration(elapsed)} · ETA ${formatDuration(eta)}`,
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const remS = Math.round(s - m * 60);
  return `${m}m ${remS}s`;
}

function getBatchUrl(batchId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return `${base}/data-entry/batches/${batchId}`;
}

// ── Arg parsing ─────────────────────────────────────────────

type CliArgs = {
  recordId: string | null;
  objectType: 'Lead' | 'Opportunity';
  dryRun: boolean;
  backfillQuery: string | null;
  concurrency: number;
  skipCompleted: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    recordId: null,
    objectType: 'Lead',
    dryRun: false,
    backfillQuery: null,
    concurrency: 2,
    skipCompleted: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--record-id':
        args.recordId = argv[++i] ?? null;
        break;
      case '--object-type':
        args.objectType = (argv[++i] === 'Opportunity' ? 'Opportunity' : 'Lead');
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--backfill-query':
        args.backfillQuery = argv[++i] ?? null;
        break;
      case '--concurrency':
        args.concurrency = parseInt(argv[++i] ?? '2', 10) || 2;
        break;
      case '--skip-completed':
        args.skipCompleted = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
    }
  }

  return args;
}

function printUsage(): void {
  console.log(`
Usage: pnpm backfill -- [options]

Options:
  --record-id <id>          Salesforce record ID (Lead or Opportunity)
  --object-type <type>      'Lead' or 'Opportunity' (default: Lead)
  --dry-run                 Log extractions without writing to Salesforce
  --backfill-query <soql>   SOQL query to find records for batch processing
  --concurrency <n>         Max concurrent records in backfill (default: 2)
  --skip-completed          Skip records already processed (status='completed' in de_runs
                            with matching object_type + dry_run). Use to resume an
                            interrupted backfill — just re-run the same command.
  --help, -h                Show this help message

Examples:
  pnpm backfill -- --record-id 00Q1234567890AB --object-type Lead --dry-run
  pnpm backfill -- --backfill-query "SELECT Id FROM Lead WHERE Status = 'Demo Completed'" --dry-run
  pnpm backfill -- --backfill-query "SELECT Id FROM Opportunity WHERE StageName = 'Proposal'" --object-type Opportunity --concurrency 3
  # Resume an interrupted backfill (same command + --skip-completed):
  pnpm backfill -- --backfill-query "..." --object-type Opportunity --concurrency 3 --skip-completed
`);
}

main().catch((error) => {
  console.error('[data-entry] Fatal error:', error);
  process.exit(1);
});
