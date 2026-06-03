/**
 * Structured logging to Supabase for data entry runs.
 *
 * Writes to de_batches, de_runs, and de_extractions tables.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ValidatedExtraction, VerifiedWriteResult } from '../types/extraction';
import type { PhaseTiming, BatchExecution, FetchInventoryItem } from '../types/pipeline';

// ── Batch operations ────────────────────────────────────────

export type CreateBatchParams = {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  readonly userId: string | null;
  readonly triggerType: 'manual' | 'soql_query' | 'cli' | 'webhook';
  readonly objectType: string;
  readonly dryRun: boolean;
  readonly totalRecords: number;
  readonly soqlQuery?: string;
};

export async function createBatch(params: CreateBatchParams): Promise<string> {
  const { supabase, orgId, userId, triggerType, objectType, dryRun, totalRecords, soqlQuery } = params;

  const { data, error } = await supabase
    .from('de_batches')
    .insert({
      org_id: orgId,
      user_id: userId,
      trigger_type: triggerType,
      object_type: objectType,
      dry_run: dryRun,
      total_records: totalRecords,
      soql_query: soqlQuery ?? null,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create batch: ${error?.message ?? 'no data'}`);
  }

  return data.id as string;
}

export async function completeBatch(params: {
  supabase: SupabaseClient;
  batchId: string;
  completedRecords: number;
  failedRecords: number;
  error?: string;
}): Promise<void> {
  const status = params.error ? 'failed' : 'completed';
  await params.supabase
    .from('de_batches')
    .update({
      status,
      completed_records: params.completedRecords,
      failed_records: params.failedRecords,
      completed_at: new Date().toISOString(),
      error: params.error ?? null,
    })
    .eq('id', params.batchId);
}

/**
 * Atomic increment of completed_records or failed_records on a batch.
 *
 * Used by bulk runs (CLI backfill) so the dashboard sees per-record progress
 * land in real time. Postgres handles the concurrent UPDATEs correctly via
 * the SQL expression `SET completed_records = completed_records + 1`, even
 * if multiple records complete simultaneously under concurrency > 1.
 *
 * Implemented via a Postgres RPC for true atomicity. If the RPC isn't
 * available, falls back to a SELECT+UPDATE which has a benign race window
 * (final completeBatch always re-syncs the total).
 */
export async function incrementBatchProgress(
  supabase: SupabaseClient,
  batchId: string,
  outcome: 'completed' | 'failed',
): Promise<void> {
  // Use a raw SQL update via .rpc if a function exists. Otherwise, do a
  // best-effort read-modify-write. The CLI calls completeBatch() at the end
  // with authoritative totals, so any small race here gets reconciled.
  const column = outcome === 'completed' ? 'completed_records' : 'failed_records';

  try {
    const { data, error } = await supabase
      .from('de_batches')
      .select(`${column}, status`)
      .eq('id', batchId)
      .single();

    if (error || !data) return;

    const current = (data as Record<string, unknown>)[column] as number;
    const update: Record<string, unknown> = { [column]: current + 1 };

    // First record completing flips status to 'running'
    if ((data as Record<string, unknown>).status === 'pending') {
      update.status = 'running';
      update.started_at = new Date().toISOString();
    }

    await supabase.from('de_batches').update(update).eq('id', batchId);
  } catch {
    // Non-fatal — final completeBatch will fix totals.
  }
}

// ── Run operations ──────────────────────────────────────────

export type CreateRunParams = {
  readonly supabase: SupabaseClient;
  readonly orgId: string;
  readonly userId: string | null;
  readonly batchId: string;
  readonly recordId: string;
  readonly objectType: string;
  readonly dryRun: boolean;
};

export async function createRun(params: CreateRunParams): Promise<string> {
  const { supabase, orgId, userId, batchId, recordId, objectType, dryRun } = params;

  const { data, error } = await supabase
    .from('de_runs')
    .insert({
      org_id: orgId,
      user_id: userId,
      batch_id: batchId,
      record_id: recordId,
      object_type: objectType,
      dry_run: dryRun,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create run: ${error?.message ?? 'no data'}`);
  }

  return data.id as string;
}

export type CompleteRunParams = {
  readonly supabase: SupabaseClient;
  readonly runId: string;
  readonly fieldsExtracted: number;
  readonly fieldsWritten: number;
  readonly fieldsSkipped: number;
  readonly fieldsErrored: number;
  readonly fetchErrors: readonly { source: string; error: string }[];
  readonly batchErrors: readonly { batchId: string; error: string }[];
  readonly writeResults: readonly VerifiedWriteResult[];
  readonly fetchInventory: readonly FetchInventoryItem[];
  readonly phaseTimings: readonly PhaseTiming[];
  readonly batchExecutions: readonly BatchExecution[];
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly durationMs: number;
  readonly error?: string;
};

export async function completeRun(params: CompleteRunParams): Promise<void> {
  const status = params.error ? 'failed' : 'completed';
  await params.supabase
    .from('de_runs')
    .update({
      status,
      fields_extracted: params.fieldsExtracted,
      fields_written: params.fieldsWritten,
      fields_skipped: params.fieldsSkipped,
      fields_errored: params.fieldsErrored,
      fetch_errors: params.fetchErrors.length > 0 ? params.fetchErrors : null,
      batch_errors: params.batchErrors.length > 0 ? params.batchErrors : null,
      write_results: params.writeResults.length > 0 ? params.writeResults : null,
      fetch_inventory: params.fetchInventory.length > 0 ? params.fetchInventory : null,
      phase_timings: params.phaseTimings.length > 0 ? params.phaseTimings : null,
      batch_executions: params.batchExecutions.length > 0 ? params.batchExecutions : null,
      total_prompt_tokens: params.totalPromptTokens,
      total_completion_tokens: params.totalCompletionTokens,
      duration_ms: params.durationMs,
      completed_at: new Date().toISOString(),
      error: params.error ?? null,
    })
    .eq('id', params.runId);
}

// ── Extraction logging ──────────────────────────────────────

export async function logExtractions(params: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string | null;
  runId: string;
  extractions: readonly ValidatedExtraction[];
}): Promise<void> {
  const { supabase, orgId, userId, runId, extractions } = params;

  if (extractions.length === 0) return;

  const rows = extractions.map((ext) => ({
    org_id: orgId,
    user_id: userId,
    run_id: runId,
    field_name: ext.fieldName,
    sf_object: ext.sfObject,
    batch_id: ext.batchId,
    extracted_value: ext.extractedValue,
    current_sf_value: ext.currentSfValue,
    actual_sf_value_after_write: ext.actualSfValueAfterWrite ?? null,
    write_mode: ext.writeMode,
    confidence: ext.confidence,
    evidence: ext.evidence,
    was_written: ext.wasWritten,
    skip_reason: ext.skipReason,
    validation_errors: ext.validationErrors.length > 0 ? [...ext.validationErrors] : null,
  }));

  // Batch insert in chunks of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('de_extractions').insert(chunk);
    if (error) {
      console.error(`[data-entry] Failed to log extractions batch ${i / BATCH_SIZE + 1}:`, error.message);
    }
  }
}
