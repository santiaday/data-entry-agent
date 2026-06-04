/**
 * Phase 3: Extraction runner.
 *
 * Default strategy: send ALL fields + full context in a single OpenAI call.
 * If the field count exceeds CHUNK_SIZE (auto-protects against very large
 * field sets), we split into chunks and run them in parallel.
 *
 * This replaces the old per-batch approach that re-sent the same context
 * 13 times per run (~182k tokens, $0.52). Single-call cuts tokens by ~6x
 * and wall time by ~2x while improving grounding (LLM sees everything at
 * once instead of narrow per-batch slices).
 */

import type { FieldConfig } from '../types/field-config';
import type { CompiledContext, BatchExecution } from '../types/pipeline';
import type { BatchExtractionResult, RawExtraction } from '../types/extraction';
import { pMapSettled } from '../utils/concurrency';
import { extractWithOpenAI } from './openai-client';
import { EXTRACTION_SYSTEM_PROMPT, buildUnifiedPrompt } from './prompt-builder';
import { parseExtractionResponse } from './response-parser';

/**
 * Fields per OpenAI call.
 *
 * 25 is the sweet spot that minimizes wall-clock time while keeping cost low:
 *   • gpt-4o generates output at ~90-100 tokens/sec
 *   • Each field produces ~80-120 tokens of JSON
 *   • 77 fields in one call = ~5,000 output tokens = ~52s wall time (too slow)
 *   • 77 fields split into 4 chunks of ~25 each, run in parallel = ~14s per chunk;
 *     since they run concurrently, wall time = slowest chunk ≈ 15s
 *
 * Context is re-sent per chunk (~19k input tokens each), but OpenAI's automatic
 * prompt caching applies a 50% discount on repeated prefixes across calls within
 * the same time window — so the effective cost is only ~40% higher than single-call
 * while being ~3.5x faster.
 */
const DEFAULT_CHUNK_SIZE = 25;

/**
 * Default concurrency when chunking.
 * 8 ensures all 4 chunks for a typical 77-field run execute in parallel.
 */
const DEFAULT_CHUNK_CONCURRENCY = 8;

export type BatchRunnerParams = {
  readonly context: CompiledContext;
  readonly objectType: 'Lead' | 'Opportunity';
  /** Field configs to run against (loaded from DB or code). */
  readonly fieldConfigs: readonly FieldConfig[];
  /** System prompt (loaded from DB or code default). */
  readonly systemPrompt?: string;
  /** Optional: only run fields in specific batches (null = all). */
  readonly filterBatches?: readonly string[];
  /** Optional: only run these specific fields by SF API name (null = all). */
  readonly filterFields?: readonly string[];
  /** Max fields per OpenAI call. Default: 80. */
  readonly chunkSize?: number;
  /** Concurrency limit when chunking is needed. Default: 4. */
  readonly concurrency?: number;
};

export type BatchRunnerResult = {
  readonly extractions: readonly RawExtraction[];
  readonly batchResults: readonly BatchExtractionResult[];
  readonly batchExecutions: readonly BatchExecution[];
  readonly totalTokensUsed: { prompt: number; completion: number };
};

type SingleCallOutcome = {
  result: BatchExtractionResult;
  execution: BatchExecution;
};

/**
 * Run extraction for a record.
 *
 *   1. Filter field configs by objectType (+ optional batch filter)
 *   2. Chunk fields (default: all fields in one chunk if <= 80)
 *   3. Run each chunk as an OpenAI call (parallel if multiple chunks)
 *   4. Aggregate results
 */
export async function runExtractionBatches(
  params: BatchRunnerParams,
): Promise<BatchRunnerResult> {
  const {
    context,
    objectType,
    fieldConfigs,
    systemPrompt = EXTRACTION_SYSTEM_PROMPT,
    filterBatches,
    filterFields,
    chunkSize = DEFAULT_CHUNK_SIZE,
    concurrency = DEFAULT_CHUNK_CONCURRENCY,
  } = params;

  const applicableFields = selectApplicableFields(fieldConfigs, objectType, filterBatches, filterFields);

  if (applicableFields.length === 0) {
    return {
      extractions: [],
      batchResults: [],
      batchExecutions: [],
      totalTokensUsed: { prompt: 0, completion: 0 },
    };
  }

  // Chunk the fields. For the typical DoorLoop case (~77 fields), this is one chunk.
  const chunks = chunkArray(applicableFields, chunkSize);

  // Run chunks concurrently
  const settledResults = await pMapSettled(
    chunks,
    async (chunk, index) => runSingleCall(chunk, context, systemPrompt, chunks.length, index),
    concurrency,
  );

  // Aggregate
  const allExtractions: RawExtraction[] = [];
  const batchResults: BatchExtractionResult[] = [];
  const batchExecutions: BatchExecution[] = [];
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (let i = 0; i < settledResults.length; i++) {
    const settled = settledResults[i];

    if (settled.status === 'fulfilled') {
      const { result, execution } = settled.value;
      batchResults.push(result);
      batchExecutions.push(execution);
      totalPromptTokens += execution.promptTokens;
      totalCompletionTokens += execution.completionTokens;

      if (result.ok) {
        allExtractions.push(...result.extractions);
      }
    } else {
      // pMapSettled shouldn't surface rejected since runSingleCall catches,
      // but handle defensively.
      const error = settled.reason instanceof Error
        ? settled.reason.message
        : String(settled.reason);
      const chunkId = chunkBatchId(chunks.length, i);
      batchResults.push({ ok: false, batchId: chunkId, error });
      batchExecutions.push({
        batchId: chunkId,
        durationMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        status: 'error',
        error,
      });
    }
  }

  return {
    extractions: allExtractions,
    batchResults,
    batchExecutions,
    totalTokensUsed: {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
    },
  };
}

// ── Single OpenAI call ──────────────────────────────────────

async function runSingleCall(
  fields: readonly FieldConfig[],
  context: CompiledContext,
  systemPrompt: string,
  totalChunks: number,
  chunkIndex: number,
): Promise<SingleCallOutcome> {
  const start = Date.now();
  const batchId = chunkBatchId(totalChunks, chunkIndex);

  try {
    const userPrompt = buildUnifiedPrompt(fields, context);

    const response = await extractWithOpenAI({
      systemPrompt,
      userPrompt,
      batchId,
    });

    const extractions = parseExtractionResponse(response.content, fields);

    return {
      result: { ok: true, batchId, extractions },
      execution: {
        batchId,
        durationMs: Date.now() - start,
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        status: 'success',
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: { ok: false, batchId, error: message },
      execution: {
        batchId,
        durationMs: Date.now() - start,
        promptTokens: 0,
        completionTokens: 0,
        status: 'error',
        error: message,
      },
    };
  }
}

// ── Helpers ─────────────────────────────────────────────────

/**
 * Select which field configs a run will process: must match the object type,
 * fall within any requested batch groups, and (if a field allowlist is given)
 * be one of those fields by Salesforce API name. An empty or omitted filter
 * means "no restriction" for that dimension.
 */
export function selectApplicableFields(
  fieldConfigs: readonly FieldConfig[],
  objectType: 'Lead' | 'Opportunity',
  filterBatches?: readonly string[],
  filterFields?: readonly string[],
): FieldConfig[] {
  const batchSet = filterBatches && filterBatches.length > 0 ? new Set(filterBatches) : null;
  const fieldSet = filterFields && filterFields.length > 0 ? new Set(filterFields) : null;
  return fieldConfigs.filter((f) => {
    if (f.sfObject !== objectType) return false;
    if (batchSet && !batchSet.has(f.batchId)) return false;
    if (fieldSet && !fieldSet.has(f.fieldName)) return false;
    return true;
  });
}

function chunkArray<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return [items.slice()] as T[][];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/**
 * Name each extraction call. 'unified' for the only-one-chunk case, otherwise
 * 'chunk_1_of_N' style. Surfaced in the Performance panel per-batch breakdown.
 */
function chunkBatchId(totalChunks: number, chunkIndex: number): string {
  if (totalChunks <= 1) return 'unified';
  const n = String(chunkIndex + 1).padStart(String(totalChunks).length, '0');
  return `chunk_${n}_of_${totalChunks}`;
}
