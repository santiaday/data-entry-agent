/**
 * Pipeline orchestrator: resolve → fetch → compile → extract → validate → write → log.
 *
 * This is the core entry point for processing a single record.
 * Batch/backfill mode calls this repeatedly with concurrency control.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSalesforceToken,
  executeSoql,
  SalesforceTokenCache,
} from '@/lib/sf';
import type { RunInput, RunResult, PipelineEvent, CompiledContext, PhaseTiming, BatchExecution, FetchInventoryItem } from './types/pipeline';
import type { ValidatedExtraction, VerifiedWriteResult } from './types/extraction';
import type { SfWriteResult } from './write/sf-writer';
import type { FieldConfig } from './types/field-config';
import { loadFieldConfigs } from './config/db-loader';
import { loadActivePrompt } from './config/prompt-loader';
import { buildRelationshipGraph } from './resolve/relationship-graph';
import { fetchAllData, type FetchAllResult } from './fetch/orchestrator';
import { buildFetchInventory } from './fetch/inventory';
import { loadGongCredentials, loadOutreachCredentials } from './fetch/credentials';
import { compileContext } from './context/compiler';
import { runExtractionBatches } from './extract/batch-runner';
import { confidenceToScore } from './types/extraction';
import { validateFieldValue } from './validate/type-validators';
import { decideWrite } from './validate/write-mode';
import { writeToSalesforce } from './write/sf-writer';
import { createBatch, completeBatch, incrementBatchProgress, createRun, completeRun, logExtractions } from './logging/run-logger';
import { pMap } from './utils/concurrency';
import type { RelationshipGraph } from './resolve/types';

export type RunPipelineParams = {
  readonly input: RunInput;
  readonly supabase: SupabaseClient;
  readonly tokenCache: SalesforceTokenCache;
  /** Optional callback for SSE streaming. */
  readonly onEvent?: (event: PipelineEvent) => void;
  /**
   * If provided, this run will be attached to the existing batch instead of
   * creating its own. The caller is responsible for batch lifecycle
   * (createBatch + completeBatch). This is how bulk/backfill mode groups
   * many records under one parent batch row in the dashboard.
   */
  readonly existingBatchId?: string;
  /**
   * Override the trigger type when creating a new batch. Defaults to 'manual'.
   * Ignored when existingBatchId is provided.
   */
  readonly triggerType?: 'manual' | 'soql_query' | 'cli' | 'webhook';
};

/**
 * Run the full data entry pipeline for a single record.
 *
 * This function GUARANTEES that every call produces a queryable record in
 * de_runs (lookup by record_id + created_at). If a pre-phase failure prevents
 * creating the normal run row, we write a synthetic failure row before
 * throwing so the user always has a paper trail.
 */
export async function runPipeline(params: RunPipelineParams): Promise<RunResult> {
  const { input, supabase, tokenCache, onEvent, existingBatchId, triggerType } = params;
  const { recordId, objectType, orgId, userId, dryRun, fieldBatches, fieldNames } = input;
  const startTime = Date.now();
  const emit = onEvent ?? (() => {});

  // Track which phase is active so any failure can be attributed to it.
  let currentPhase = 'setup';
  const phaseTimings: PhaseTiming[] = [];

  // ── Stage 0: create batch + run rows (may fail — but we write a paper trail)
  let batchId: string;
  let runId: string;
  let ownBatch = !existingBatchId;

  try {
    batchId = existingBatchId ?? await createBatch({
      supabase,
      orgId,
      userId,
      triggerType: triggerType ?? 'manual',
      objectType,
      dryRun,
      totalRecords: 1,
    });

    runId = await createRun({
      supabase,
      orgId,
      userId,
      batchId,
      recordId,
      objectType,
      dryRun,
    });
  } catch (preRunError) {
    // Pre-run setup failure (Supabase unreachable, FK violation, etc.)
    // Try to write a synthetic failure row so the user can see what happened.
    const errorContext = formatError(preRunError, 'setup', orgId);
    await writeSyntheticFailureRow({
      supabase,
      orgId,
      userId,
      batchId: existingBatchId ?? null,
      recordId,
      objectType,
      dryRun,
      error: errorContext,
      startedAt: new Date(startTime).toISOString(),
      durationMs: Date.now() - startTime,
    });

    emit({ type: 'error', error: errorContext });

    return {
      runId: '',
      recordId,
      objectType,
      status: 'failed',
      dryRun,
      fieldsExtracted: 0, fieldsWritten: 0, fieldsSkipped: 0, fieldsErrored: 0,
      fetchErrors: [], batchErrors: [],
      phaseTimings: [], batchExecutions: [],
      totalPromptTokens: 0, totalCompletionTokens: 0,
      durationMs: Date.now() - startTime,
      error: errorContext,
    };
  }

  const timedPhase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const phaseStart = Date.now();
    currentPhase = name;
    emit({ type: 'phase', phase: name, status: 'started' });
    try {
      return await fn();
    } finally {
      phaseTimings.push({ phase: name, durationMs: Date.now() - phaseStart });
      emit({ type: 'phase', phase: name, status: 'done' });
    }
  };

  try {
    // ── Phase 0: Load config from DB (field configs + system prompt) ─
    // Both seed from code defaults on first run per-org, then become editable via UI.
    const [fieldConfigs, systemPrompt] = await Promise.all([
      loadFieldConfigs(supabase, orgId),
      loadActivePrompt(supabase, orgId),
    ]);

    // ── Phase 1a: Resolve ───────────────────────────────────
    const graph = await timedPhase('resolve', () =>
      buildRelationshipGraph({ recordId, objectType, orgId, supabase, tokenCache }),
    );

    // ── Phase 1b: Fetch ─────────────────────────────────────
    const fetchResults = await timedPhase('fetch', async () => {
      const [gongCreds, outreachCreds] = await Promise.all([
        loadGongCredentials(supabase, orgId),
        loadOutreachCredentials(supabase, orgId),
      ]);

      const results = await fetchAllData({
        graph,
        orgId,
        supabase,
        tokenCache,
        gongCreds,
        outreachCreds,
      });

      // Emit per-source fetch results
      for (const key of Object.keys(results) as (keyof FetchAllResult)[]) {
        if (key === 'fetchErrors') continue;
        const result = results[key];
        if (typeof result === 'object' && result !== null && 'ok' in result) {
          emit({
            type: 'fetch_result',
            source: key,
            ok: result.ok,
            error: result.ok ? undefined : (result as { error: string }).error,
          });
        }
      }

      return results;
    });

    // ── Phase 2: Compile Context ────────────────────────────
    const context = await timedPhase('compile', async () => compileContext(fetchResults));

    // ── Phase 3: Extract ────────────────────────────────────
    const extractionResult = await timedPhase('extract', () =>
      runExtractionBatches({
        context,
        objectType,
        fieldConfigs,
        systemPrompt,
        filterBatches: fieldBatches ? [...fieldBatches] : undefined,
        filterFields: fieldNames ? [...fieldNames] : undefined,
      }),
    );

    // ── Phase 4a: Validate + Write Mode ─────────────────────
    const validated = await timedPhase('validate', async () => {
      const currentValues = await fetchCurrentFieldValues({
        graph,
        objectType,
        orgId,
        supabase,
        tokenCache,
        fieldNames: extractionResult.extractions.map((e) => e.fieldName),
      });

      return validateAndDecideWrites({
        extractions: extractionResult.extractions,
        currentValues,
        fieldConfigs,
        dryRun,
        objectType,
      });
    });

    // ── Phase 4b: Write to SF + verify ──────────────────────
    const recordIds = buildRecordIdMap(graph, objectType);
    let verifiedWriteResults: readonly VerifiedWriteResult[] = [];
    let finalValidated: readonly ValidatedExtraction[] = validated;

    if (!dryRun) {
      const { verified, updatedValidated } = await timedPhase('write', async () => {
        const writableExtractions = validated.filter((v) => v.wasWritten);
        if (writableExtractions.length === 0) {
          return { verified: [] as VerifiedWriteResult[], updatedValidated: validated };
        }

        // 1. Send the PATCH(es) and capture per-object results
        const patchResults = await writeToSalesforce({
          supabase,
          orgId,
          tokenCache,
          extractions: writableExtractions,
          recordIds,
        });

        // 2. Re-query SF to capture what actually persisted (detects silent drops,
        //    e.g. field-level-security on AI_* fields preventing updates).
        const postWriteValues = await fetchCurrentFieldValues({
          graph,
          objectType,
          orgId,
          supabase,
          tokenCache,
          fieldNames: writableExtractions.map((e) => e.fieldName),
        });

        // 3. Compare attempted vs actual, flag silent failures on each extraction
        const updated = applyWriteVerification(validated, postWriteValues, patchResults);

        // 4. Build per-object verification summary for run-level logging
        const verification = buildVerificationSummary(updated, patchResults, recordIds);

        return {
          verified: verification,
          updatedValidated: updated,
        };
      });

      verifiedWriteResults = verified;
      finalValidated = updatedValidated;
    }

    // ── Emit per-field extractions ──────────────────────────
    for (const ext of finalValidated) {
      emit({
        type: 'extraction',
        fieldName: ext.fieldName,
        value: ext.extractedValue,
        confidence: ext.confidence,
        wasWritten: ext.wasWritten,
      });
    }

    // ── Log results ─────────────────────────────────────────
    const fieldsExtracted = finalValidated.filter((v) => v.extractedValue !== null).length;
    const fieldsWritten = finalValidated.filter((v) => v.wasWritten).length;
    const fieldsSkipped = finalValidated.filter((v) => v.skipReason !== null && !v.wasWritten).length;
    const fieldsErrored = finalValidated.filter((v) => v.validationErrors.length > 0).length;
    const batchErrors = extractionResult.batchResults
      .filter((b) => !b.ok)
      .map((b) => ({ batchId: b.batchId, error: (b as { error: string }).error }));

    const durationMs = Date.now() - startTime;

    // Build inventory of what each fetch source actually retrieved.
    // Stored per-run so the Run Detail UI can show a "Context Found" table.
    const fetchInventory = buildFetchInventory(fetchResults);

    await logExtractions({ supabase, orgId, userId, runId, extractions: finalValidated });

    await completeRun({
      supabase,
      runId,
      fieldsExtracted,
      fieldsWritten,
      fieldsSkipped,
      fieldsErrored,
      fetchErrors: fetchResults.fetchErrors,
      batchErrors,
      writeResults: verifiedWriteResults,
      fetchInventory,
      phaseTimings,
      batchExecutions: extractionResult.batchExecutions,
      totalPromptTokens: extractionResult.totalTokensUsed.prompt,
      totalCompletionTokens: extractionResult.totalTokensUsed.completion,
      durationMs,
    });

    if (ownBatch) {
      await completeBatch({
        supabase,
        batchId,
        completedRecords: 1,
        failedRecords: 0,
      });
    } else {
      await incrementBatchProgress(supabase, batchId, 'completed');
    }

    const result: RunResult = {
      runId,
      recordId,
      objectType,
      status: 'completed',
      dryRun,
      fieldsExtracted,
      fieldsWritten,
      fieldsSkipped,
      fieldsErrored,
      fetchErrors: fetchResults.fetchErrors,
      batchErrors,
      phaseTimings,
      batchExecutions: [...extractionResult.batchExecutions],
      totalPromptTokens: extractionResult.totalTokensUsed.prompt,
      totalCompletionTokens: extractionResult.totalTokensUsed.completion,
      durationMs,
    };

    emit({
      type: 'done',
      runId,
      summary: { extracted: fieldsExtracted, written: fieldsWritten, skipped: fieldsSkipped, errored: fieldsErrored },
    });

    return result;
  } catch (error) {
    const errorContext = formatError(error, currentPhase, orgId);
    const durationMs = Date.now() - startTime;

    // ALWAYS write the completeRun with full error context, regardless of
    // which phase failed. This is the main paper trail the user queries.
    await completeRun({
      supabase,
      runId,
      fieldsExtracted: 0,
      fieldsWritten: 0,
      fieldsSkipped: 0,
      fieldsErrored: 0,
      fetchErrors: [],
      batchErrors: [],
      writeResults: [],
      fetchInventory: [],
      phaseTimings,
      batchExecutions: [],
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      durationMs,
      error: errorContext,
    });

    if (ownBatch) {
      await completeBatch({
        supabase,
        batchId,
        completedRecords: 0,
        failedRecords: 1,
        error: errorContext,
      });
    } else {
      await incrementBatchProgress(supabase, batchId, 'failed');
    }

    emit({ type: 'error', error: errorContext });

    return {
      runId,
      recordId,
      objectType,
      status: 'failed',
      dryRun,
      fieldsExtracted: 0,
      fieldsWritten: 0,
      fieldsSkipped: 0,
      fieldsErrored: 0,
      fetchErrors: [],
      batchErrors: [],
      phaseTimings,
      batchExecutions: [],
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      durationMs,
      error: errorContext,
    };
  }
}

/**
 * Format an error into a rich, multi-line string for storage in de_runs.error.
 *
 * Captures:
 *   - phase + orgId context
 *   - error name + message
 *   - custom properties (statusCode, errorCode, source, objectType, etc.)
 *   - node:fetch `cause` chain (bare "fetch failed" becomes useful with cause)
 *   - top stack frames
 *
 * Without the cause-chain walk, Node's fetch failures show up as just
 * "fetch failed" with no hint whether it was DNS, TCP, TLS, or something else.
 */
function formatError(error: unknown, phase: string, orgId: string): string {
  const lines: string[] = [];
  lines.push(`[phase=${phase}] [org=${orgId}]`);

  appendErrorDetails(error, lines, 0);

  return lines.join('\n');
}

function appendErrorDetails(error: unknown, lines: string[], depth: number): void {
  const indent = depth === 0 ? '' : `${'  '.repeat(depth)}caused by → `;

  if (error instanceof Error) {
    lines.push(`${indent}${error.name}: ${error.message}`);

    // Extract common enrichment fields from our custom error classes
    const anyErr = error as Error & {
      statusCode?: unknown;
      errorCode?: unknown;
      code?: unknown;
      source?: unknown;
      objectType?: unknown;
      recordId?: unknown;
      batchId?: unknown;
      fieldName?: unknown;
      errno?: unknown;
      syscall?: unknown;
      hostname?: unknown;
      address?: unknown;
      port?: unknown;
    };
    const extras: string[] = [];
    if (anyErr.statusCode !== undefined) extras.push(`statusCode=${anyErr.statusCode}`);
    if (anyErr.errorCode !== undefined) extras.push(`errorCode=${anyErr.errorCode}`);
    if (anyErr.code !== undefined) extras.push(`code=${anyErr.code}`);
    if (anyErr.errno !== undefined) extras.push(`errno=${anyErr.errno}`);
    if (anyErr.syscall !== undefined) extras.push(`syscall=${anyErr.syscall}`);
    if (anyErr.hostname !== undefined) extras.push(`hostname=${anyErr.hostname}`);
    if (anyErr.address !== undefined) extras.push(`address=${anyErr.address}`);
    if (anyErr.port !== undefined) extras.push(`port=${anyErr.port}`);
    if (anyErr.source !== undefined) extras.push(`source=${anyErr.source}`);
    if (anyErr.objectType !== undefined) extras.push(`objectType=${anyErr.objectType}`);
    if (anyErr.recordId !== undefined) extras.push(`recordId=${anyErr.recordId}`);
    if (anyErr.batchId !== undefined) extras.push(`batchId=${anyErr.batchId}`);
    if (anyErr.fieldName !== undefined) extras.push(`fieldName=${anyErr.fieldName}`);
    if (extras.length > 0) lines.push(`${indent.replace(/caused by.*/, '  ')}${extras.join(' ')}`);

    // Walk the cause chain. Node's `fetch failed` always wraps the real error
    // in .cause (e.g. UND_ERR_CONNECT_TIMEOUT, ENOTFOUND, ECONNRESET).
    // Cap at depth 5 to avoid runaway recursion on circular causes.
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined && cause !== null && depth < 5) {
      appendErrorDetails(cause, lines, depth + 1);
    }

    if (depth === 0 && error.stack) {
      const stackLines = error.stack.split('\n').slice(0, 7).join('\n');
      lines.push(stackLines);
    }
  } else if (error !== null && error !== undefined) {
    lines.push(`${indent}${String(error)}`);
  }
}

/**
 * Write a best-effort failure row to de_runs when the normal setup path
 * (createBatch or createRun) fails. Without this, a pre-phase failure
 * would leave zero trace in Supabase for that recordId.
 *
 * We try to attach to the caller's parent batch if one was provided.
 * If NO batch exists, we write the row without a batch_id — but if the
 * schema requires batch_id (it does: NOT NULL + FK), we fall back to
 * creating a tiny one-off "setup_failure" batch to host the run.
 */
async function writeSyntheticFailureRow(params: {
  supabase: SupabaseClient;
  orgId: string;
  userId: string | null;
  batchId: string | null;
  recordId: string;
  objectType: string;
  dryRun: boolean;
  error: string;
  startedAt: string;
  durationMs: number;
}): Promise<void> {
  const { supabase, orgId, userId, batchId, recordId, objectType, dryRun, error, startedAt, durationMs } = params;
  try {
    let effectiveBatchId = batchId;
    if (!effectiveBatchId) {
      // No parent batch — create a one-off "setup_failure" batch so the run row can attach
      const { data } = await supabase
        .from('de_batches')
        .insert({
          org_id: orgId,
          user_id: userId,
          trigger_type: 'manual',
          object_type: objectType,
          dry_run: dryRun,
          total_records: 1,
          failed_records: 1,
          status: 'failed',
          error: `Setup failed before run could start: ${error.split('\n')[1] ?? error.slice(0, 200)}`,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      effectiveBatchId = (data?.id as string) ?? null;
    }

    if (!effectiveBatchId) {
      // Couldn't even create a batch — log to console; nothing more we can do.
      console.error(`[data-entry] Could not persist failure row for ${recordId}:`, error);
      return;
    }

    await supabase.from('de_runs').insert({
      org_id: orgId,
      user_id: userId,
      batch_id: effectiveBatchId,
      record_id: recordId,
      object_type: objectType,
      dry_run: dryRun,
      status: 'failed',
      fields_extracted: 0,
      fields_written: 0,
      fields_skipped: 0,
      fields_errored: 0,
      duration_ms: durationMs,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      error,
    });
  } catch (dbErr) {
    // Absolute last resort — nothing we can persist. At least surface to logs.
    console.error(`[data-entry] FATAL: could not write synthetic failure row for ${recordId}`, {
      originalError: error,
      dbError: dbErr,
    });
  }
}

// ── Helpers ─────────────────────────────────────────────────

function validateAndDecideWrites(params: {
  extractions: readonly import('./types/extraction').RawExtraction[];
  currentValues: Map<string, string | null>;
  fieldConfigs: readonly FieldConfig[];
  dryRun: boolean;
  objectType: string;
}): ValidatedExtraction[] {
  const { extractions, currentValues, fieldConfigs, dryRun, objectType } = params;

  return extractions.map((raw) => {
    const fieldConfig = fieldConfigs.find((f) => f.fieldName === raw.fieldName && f.sfObject === objectType);
    if (!fieldConfig) {
      return {
        fieldName: raw.fieldName,
        sfObject: objectType,
        batchId: 'unknown',
        extractedValue: raw.value,
        currentSfValue: currentValues.get(raw.fieldName) ?? null,
        confidence: confidenceToScore(raw.confidence),
        evidence: raw.evidence,
        writeMode: 'overwrite' as const,
        wasWritten: false,
        skipReason: 'unknown_field',
        validationErrors: [],
      };
    }

    const currentSfValue = currentValues.get(raw.fieldName) ?? null;

    // Case A: LLM returned null — no evidence found for this field in the
    // record's context. This is distinct from a validation failure (LLM found
    // a value but it was rejected by our rules). Use 'no_context_found' so
    // analytics surfaces the two cases independently.
    if (raw.value === null) {
      return {
        fieldName: raw.fieldName,
        sfObject: fieldConfig.sfObject,
        batchId: fieldConfig.batchId,
        extractedValue: null,
        currentSfValue,
        confidence: confidenceToScore(raw.confidence),
        evidence: raw.evidence,
        writeMode: fieldConfig.writeMode,
        wasWritten: false,
        skipReason: 'no_context_found',
        validationErrors: [],
      };
    }

    // Validate + clean the extracted value. For multipicklist, invalid options
    // are stripped while valid ones are kept — partial success is preferred
    // over total failure.
    const validation = validateFieldValue(raw.value, fieldConfig);

    // Case B: LLM returned a value but it failed our validation rules
    // (bad picklist, wrong format, out of range, etc).
    if (!validation.safeToWrite) {
      return {
        fieldName: raw.fieldName,
        sfObject: fieldConfig.sfObject,
        batchId: fieldConfig.batchId,
        // Show the original value (pre-cleaning) so the user sees what the LLM actually returned
        extractedValue: raw.value,
        currentSfValue,
        confidence: confidenceToScore(raw.confidence),
        evidence: raw.evidence,
        writeMode: fieldConfig.writeMode,
        wasWritten: false,
        skipReason: 'validation_failed',
        validationErrors: validation.errors,
      };
    }

    // Apply write mode logic using the cleaned value
    const decision = decideWrite({
      extractedValue: validation.cleanedValue,
      currentSfValue,
      writeMode: fieldConfig.writeMode,
      dryRun,
    });

    return {
      fieldName: raw.fieldName,
      sfObject: fieldConfig.sfObject,
      batchId: fieldConfig.batchId,
      // Record the cleaned value so downstream (write phase + UI) sees what
      // actually got written. For multipicklist this may be a subset of what
      // the LLM originally returned.
      extractedValue: validation.cleanedValue,
      currentSfValue,
      confidence: confidenceToScore(raw.confidence),
      evidence: raw.evidence,
      writeMode: fieldConfig.writeMode,
      wasWritten: decision.shouldWrite,
      skipReason: decision.skipReason,
      // Surface any non-fatal cleaning notes (e.g. "stripped X invalid options")
      validationErrors: validation.errors,
    };
  });
}

async function fetchCurrentFieldValues(params: {
  graph: RelationshipGraph;
  objectType: string;
  orgId: string;
  supabase: SupabaseClient;
  tokenCache: SalesforceTokenCache;
  fieldNames: readonly string[];
}): Promise<Map<string, string | null>> {
  const values = new Map<string, string | null>();
  const { graph, objectType, orgId, supabase, tokenCache, fieldNames } = params;

  if (fieldNames.length === 0) return values;

  // Determine which record to fetch current values from
  const recordId = objectType === 'Lead' ? graph.leadId : graph.opportunityId;
  if (!recordId) return values;

  try {
    // Fetch only the AI fields we need (not FIELDS(ALL) — focused query)
    const aiFields = fieldNames.filter((f) => f.startsWith('AI_'));
    if (aiFields.length === 0) return values;

    const soql = `SELECT ${aiFields.join(', ')} FROM ${objectType} WHERE Id = '${recordId.replace(/[^a-zA-Z0-9]/g, '')}' LIMIT 1`;
    const result = await executeSoql({ query: soql, orgId, supabase, tokenCache });

    if (result.records.length > 0) {
      const record = result.records[0];
      for (const field of aiFields) {
        const val = record[field];
        values.set(field, val !== null && val !== undefined ? String(val) : null);
      }
    }
  } catch {
    // Non-fatal: if we can't fetch current values, proceed without them
    // (write mode will default to overwrite behavior)
  }

  return values;
}

function buildRecordIdMap(
  graph: RelationshipGraph,
  objectType: string,
): Record<string, string> {
  const ids: Record<string, string> = {};
  if (graph.leadId) ids['Lead'] = graph.leadId;
  if (graph.opportunityId) ids['Opportunity'] = graph.opportunityId;
  if (graph.accountId) ids['Account'] = graph.accountId;
  return ids;
}

// ── Post-write verification ─────────────────────────────────

/**
 * For each extraction we tried to write, compare the expected written value
 * against what SF actually shows after a re-query. Mismatches are almost always
 * FLS restrictions on the API user's profile — SF's REST API returns 204 on
 * such writes but silently drops the disallowed fields.
 *
 * Returns a new array with updated wasWritten + skipReason + actualSfValueAfterWrite.
 */
function applyWriteVerification(
  validated: readonly ValidatedExtraction[],
  postWriteValues: Map<string, string | null>,
  patchResults: readonly SfWriteResult[],
): ValidatedExtraction[] {
  // Object-level error: PATCH exhausted all retries (e.g. auth failure, no recordId).
  const objectErrors = new Map<string, string>();
  // Field-level rejections: SF explicitly rejected a specific field
  // (e.g. bad picklist value, missing required reference).
  const objectFieldRejections = new Map<string, Record<string, string>>();

  for (const r of patchResults) {
    if (r.error && Object.keys(r.rejectedFields ?? {}).length === 0) {
      // Error with no specific field attribution = whole-PATCH failure
      objectErrors.set(r.objectType, r.error);
    }
    if (r.rejectedFields && Object.keys(r.rejectedFields).length > 0) {
      objectFieldRejections.set(r.objectType, r.rejectedFields);
    }
  }

  return validated.map((v) => {
    if (!v.wasWritten) return v;

    const actualSfValueAfterWrite = postWriteValues.has(v.fieldName)
      ? postWriteValues.get(v.fieldName) ?? null
      : null;

    // 1. Object-level write error (no rejections parsed) → whole object failed
    if (objectErrors.has(v.sfObject)) {
      return {
        ...v,
        wasWritten: false,
        skipReason: 'write_failed',
        actualSfValueAfterWrite,
        validationErrors: [...v.validationErrors, `SF PATCH failed: ${objectErrors.get(v.sfObject)}`],
      };
    }

    // 2. Field-level rejection by SF (e.g. bad picklist value)
    const rejections = objectFieldRejections.get(v.sfObject);
    if (rejections && v.fieldName in rejections) {
      return {
        ...v,
        wasWritten: false,
        skipReason: 'sf_rejected',
        actualSfValueAfterWrite,
        validationErrors: [
          ...v.validationErrors,
          `Salesforce rejected this field: ${rejections[v.fieldName]}`,
        ],
      };
    }

    // 3. Silent drop: SF returned 204 but the value didn't actually change.
    //    For 'append' we check "contains"; for overwrite/fill_blank exact match.
    const landed = didValueLandInSf(v, actualSfValueAfterWrite);

    if (!landed) {
      return {
        ...v,
        wasWritten: false,
        skipReason: 'write_silently_dropped',
        actualSfValueAfterWrite,
        validationErrors: [
          ...v.validationErrors,
          'Salesforce returned success but the field value did not change — likely a field-level-security restriction on the API user.',
        ],
      };
    }

    return { ...v, actualSfValueAfterWrite };
  });
}

/** Did the write actually land in SF? */
function didValueLandInSf(
  extraction: ValidatedExtraction,
  actualAfter: string | null,
): boolean {
  const attempted = extraction.extractedValue;
  if (attempted === null) return true;

  if (extraction.writeMode === 'append') {
    // For append mode the stored value should CONTAIN the attempted value.
    return typeof actualAfter === 'string' && actualAfter.includes(attempted);
  }

  return valuesEquivalent(attempted, actualAfter);
}

/**
 * Compare a value we sent to SF against what SF shows on re-query.
 * SF normalizes many values (datetime format, number precision, boolean
 * representation) so a raw string compare would produce many false "SF dropped"
 * flags. Handle the common types explicitly.
 */
function valuesEquivalent(a: string | null, b: string | null): boolean {
  const na = normalizeStr(a);
  const nb = normalizeStr(b);
  if (na === null || nb === null) return na === nb;

  // Datetime (with time component). SF returns "2026-04-07T21:19:45.000+0000"
  // even though we sent "2026-04-07T21:19:45Z". Same instant, different format.
  if (isDateTimeLike(na) && isDateTimeLike(nb)) {
    const ta = Date.parse(na);
    const tb = Date.parse(nb);
    if (!isNaN(ta) && !isNaN(tb)) {
      // 1-second tolerance absorbs SF's millisecond precision + timezone format.
      return Math.abs(ta - tb) < 1000;
    }
  }

  // Date-only (no time component on either side)
  if (isDateOnly(na) && isDateOnly(nb)) return na === nb;

  // Numeric (handles "5" vs "5.00", "60" vs "60.0", etc.)
  if (isNumericString(na) && isNumericString(nb)) {
    return parseFloat(na) === parseFloat(nb);
  }

  // Boolean (we send "true"/"false"; SF may round-trip as the same)
  if (isBooleanLike(na) && isBooleanLike(nb)) {
    return na.toLowerCase() === nb.toLowerCase();
  }

  // Multipicklist: SF returns values in its own order with "; " separator.
  // We send "A;B;C"; SF may return "B; C; A". Compare as sets.
  if (na.includes(';') && nb.includes(';')) {
    const setA = new Set(na.split(/;\s*/).map((v) => v.trim()).filter(Boolean));
    const setB = new Set(nb.split(/;\s*/).map((v) => v.trim()).filter(Boolean));
    if (setA.size === setB.size) {
      for (const v of setA) if (!setB.has(v)) return false;
      return true;
    }
  }

  return na === nb;
}

function normalizeStr(s: string | null): string | null {
  if (s === null || s === undefined) return null;
  const trimmed = s.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isDateTimeLike(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
}

function isDateOnly(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isNumericString(s: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(s);
}

function isBooleanLike(s: string): boolean {
  const l = s.toLowerCase();
  return l === 'true' || l === 'false';
}

/**
 * Aggregate per-object verification counts for the run summary.
 * This is what shows up in de_runs.write_results + the RunDetailView.
 */
function buildVerificationSummary(
  updated: readonly ValidatedExtraction[],
  patchResults: readonly SfWriteResult[],
  recordIds: Record<string, string>,
): VerifiedWriteResult[] {
  const countable: ValidatedExtraction['skipReason'][] = [
    'write_silently_dropped',
    'write_failed',
    'sf_rejected',
  ];

  const byObject = new Map<string, {
    attempted: number;
    written: number;
    dropped: number;
    rejected: number;
  }>();

  for (const v of updated) {
    const counted = v.wasWritten || countable.includes(v.skipReason);
    if (!counted) continue;

    const key = v.sfObject;
    if (!byObject.has(key)) {
      byObject.set(key, { attempted: 0, written: 0, dropped: 0, rejected: 0 });
    }
    const agg = byObject.get(key)!;
    agg.attempted++;
    if (v.wasWritten) agg.written++;
    else if (v.skipReason === 'write_silently_dropped') agg.dropped++;
    else if (v.skipReason === 'sf_rejected') agg.rejected++;
  }

  const patchByObject = new Map(patchResults.map((p) => [p.objectType, p]));

  const summaries: VerifiedWriteResult[] = [];
  for (const [objectType, counts] of byObject) {
    const patch = patchByObject.get(objectType);

    // If SF rejected fields individually, surface that as the main error
    // so the UI headline shows "54 written, 1 rejected" rather than a
    // generic PATCH-level error message (since the PATCH actually succeeded
    // after auto-retry).
    const hasRejections = Object.keys(patch?.rejectedFields ?? {}).length > 0;
    const errorSummary = patch?.error
      ?? (hasRejections
        ? `${counts.rejected} field(s) rejected by Salesforce — see per-field details`
        : null);

    summaries.push({
      objectType,
      recordId: recordIds[objectType] ?? patch?.recordId ?? '',
      fieldsAttempted: counts.attempted,
      fieldsVerifiedWritten: counts.written,
      silentlyDropped: counts.dropped,
      error: errorSummary,
    });
  }

  return summaries;
}
