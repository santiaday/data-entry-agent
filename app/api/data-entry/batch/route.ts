/**
 * POST /api/data-entry/batch — Start a batch of records via SOQL query.
 *
 * Returns 202 with batchId immediately.
 * Records are processed in the background (up to 5 per web invocation).
 * Larger batches should use the CLI.
 */

import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { z } from 'zod';
import { SalesforceTokenCache, executeSoql, validateSoql, clampSoqlLimit } from '@/lib/sf';
import {
  runPipeline,
  createBatch,
  completeBatch,
  createRun,
} from '@/lib/pipeline';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const tokenCache = new SalesforceTokenCache();

/**
 * Cap on records per web-triggered batch.
 *
 * Local dev (next dev): no enforced timeout, so this cap is set high enough
 * that practical use isn't blocked. Each record takes ~30-60s, so 100 records
 * could take an hour — but the user's browser session can stay open and
 * periodic polling shows progress.
 *
 * IF/WHEN HOSTING ON VERCEL: serverless functions cap at 300s (Pro tier).
 * For batches that take longer than that, you'll need to switch to one of:
 *   1. The CLI: `pnpm data-entry -- --backfill-query "..."` — no timeout
 *   2. A queue + worker (Inngest, QStash, Trigger.dev) for true background jobs
 *   3. Client-side fan-out: UI loops over IDs and calls /api/data-entry/run for each
 * Lower this cap to ~5 if you go to production without #2 or #3.
 */
const MAX_WEB_BATCH_SIZE = 1000;

const requestSchema = z.object({
  soqlQuery: z.string().min(10).max(5000),
  objectType: z.enum(['Lead', 'Opportunity']),
  dryRun: z.boolean().optional().default(false),
  fieldBatches: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }
  const dePerms = ctx.permissions.modules.data_entry;
  if (!dePerms.access || !dePerms.can_run_batches) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message, code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const { soqlQuery, objectType, dryRun, fieldBatches } = parsed.data;
  const orgId = ctx.orgId;
  const userBatchCap =
    typeof dePerms.max_batch_size === 'number' ? dePerms.max_batch_size : MAX_WEB_BATCH_SIZE;
  const supabase = createServiceClient();

  // Validate + sanitize the SOQL (strips PII, injects Test_Account__c filter, rejects DML/CASE WHEN).
  const validation = validateSoql(soqlQuery, []);
  if (!validation.ok) {
    return NextResponse.json(
      { error: `Invalid SOQL: ${validation.errors.join(', ')}`, code: 'INVALID_SOQL' },
      { status: 400 },
    );
  }

  // Enforce the user's batch-size cap at the SOQL level so Salesforce never
  // returns more records than the user is permitted to process. If the query
  // already specifies a smaller LIMIT we keep it.
  const cappedQuery = clampSoqlLimit(validation.sanitizedQuery, userBatchCap);

  try {
    // Execute the sanitized + capped query to get record IDs
    const queryResult = await executeSoql({
      query: cappedQuery,
      orgId,
      supabase,
      tokenCache,
    });

    const recordIds = queryResult.records.map((r) => r.Id as string);

    if (recordIds.length === 0) {
      return NextResponse.json(
        { error: 'Query returned no records', code: 'NO_RECORDS' },
        { status: 400 },
      );
    }

    // Defense in depth: the SOQL LIMIT should prevent this, but belt-and-suspenders
    // in case the LIMIT injection is ever bypassed.
    if (recordIds.length > userBatchCap) {
      return NextResponse.json(
        {
          error: `Query returned ${recordIds.length} records, which exceeds your batch-size limit of ${userBatchCap}. Narrow your query or ask an admin to raise your limit.`,
          code: 'BATCH_TOO_LARGE',
          totalRecords: recordIds.length,
          maxAllowed: userBatchCap,
        },
        { status: 400 },
      );
    }

    // Create batch
    const batchId = await createBatch({
      supabase,
      orgId,
      userId: ctx.userId,
      triggerType: 'soql_query',
      objectType,
      dryRun,
      totalRecords: recordIds.length,
      soqlQuery: cappedQuery,
    });

    // Process records sequentially in the background (after returning 202)
    // Note: In Vercel serverless, we can't truly background this after the response.
    // Instead we process inline and rely on maxDuration=300s.
    processRecords({
      batchId,
      recordIds,
      objectType,
      dryRun,
      fieldBatches,
      supabase,
      orgId,
      userId: ctx.userId,
    }).catch((err) => {
      console.error('[data-entry] Batch processing failed:', err);
    });

    return NextResponse.json(
      {
        batchId,
        totalRecords: recordIds.length,
        status: 'running',
        message: `Processing ${recordIds.length} records`,
      },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message, code: 'BATCH_FAILED' },
      { status: 500 },
    );
  }
}

async function processRecords(params: {
  batchId: string;
  recordIds: string[];
  objectType: 'Lead' | 'Opportunity';
  dryRun: boolean;
  fieldBatches?: string[];
  supabase: ReturnType<typeof createServiceClient>;
  orgId: string;
  userId: string | null;
}): Promise<void> {
  const { batchId, recordIds, objectType, dryRun, fieldBatches, supabase, orgId, userId } = params;
  let completed = 0;
  let failed = 0;

  for (const recordId of recordIds) {
    try {
      const result = await runPipeline({
        input: {
          recordId,
          objectType,
          orgId,
          userId,
          dryRun,
          fieldBatches,
        },
        supabase,
        tokenCache,
        // Attach this run to the parent batch we created above; runPipeline
        // will atomically increment its progress counter as it finishes.
        existingBatchId: batchId,
        triggerType: 'soql_query',
      });

      if (result.status === 'completed') {
        completed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  await completeBatch({
    supabase,
    batchId,
    completedRecords: completed,
    failedRecords: failed,
  });
}
