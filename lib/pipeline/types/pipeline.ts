/**
 * Types for the data entry pipeline execution.
 */

import type { SfObject } from './field-config';

/** Input to run the pipeline for a single record. */
export type RunInput = {
  readonly recordId: string;
  readonly objectType: SfObject;
  readonly orgId: string;
  /** Authenticated user who triggered this run. Null for CLI / cron. */
  readonly userId: string | null;
  readonly dryRun: boolean;
  /** Optional: only run specific batches (null = all 14). */
  readonly fieldBatches?: readonly string[];
  /**
   * Optional: only extract/write these specific fields, by Salesforce API name
   * (e.g. ['AI_Buyer_Persona__c']). Undefined or empty = all fields for the
   * object. Scoping to a few fields cuts cost: fewer fields → fewer LLM chunks,
   * so the large context isn't re-sent as many times.
   */
  readonly fieldNames?: readonly string[];
};

/** Input to run the pipeline for a batch of records. */
export type BatchInput = {
  readonly soqlQuery: string;
  readonly objectType: SfObject;
  readonly orgId: string;
  readonly userId: string | null;
  readonly dryRun: boolean;
  readonly fieldBatches?: readonly string[];
  readonly fieldNames?: readonly string[];
  readonly maxRecords?: number;
};

/** A record discovered in the relationship graph. */
export type RelatedRecord = {
  readonly id: string;
  readonly objectType: string;
  readonly relationship: string;
};

/** The relationship graph built from a primary record. */
export type RelationshipGraph = {
  readonly primaryRecord: {
    readonly id: string;
    readonly objectType: SfObject;
  };
  readonly accountId: string | null;
  readonly contactIds: readonly string[];
  readonly opportunityId: string | null;
  readonly leadId: string | null;
  readonly relatedRecords: readonly RelatedRecord[];
};

/** Result of a single data source fetch. */
export type FetchResult<T = unknown> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string; readonly source: string };

/** All fetch results keyed by source name. */
export type FetchResults = {
  readonly account: FetchResult;
  readonly contacts: FetchResult;
  readonly opportunities: FetchResult;
  readonly leads: FetchResult;
  readonly tasks: FetchResult;
  readonly events: FetchResult;
  readonly emailMessages: FetchResult;
  readonly gongCalls: FetchResult;
  readonly gongTranscripts: FetchResult;
  readonly gongExtensive: FetchResult;
  readonly outreachMailings: FetchResult;
};

/** A compiled context section with token count. */
export type CompiledSection = {
  readonly key: string;
  readonly content: string;
  readonly tokenCount: number;
};

/** All compiled context sections. */
export type CompiledContext = {
  readonly sections: ReadonlyMap<string, CompiledSection>;
  readonly totalTokens: number;
};

/** Phase timing for a pipeline run. */
export type PhaseTiming = {
  readonly phase: string;
  readonly durationMs: number;
};

/** Per-batch execution metrics (OpenAI calls). */
export type BatchExecution = {
  readonly batchId: string;
  readonly durationMs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly status: 'success' | 'error';
  readonly error?: string;
};

/**
 * Itemized inventory of what the fetch phase actually found — one entry
 * per data source, with the count of records retrieved and status.
 * Surfaced in the run detail UI as a "Context Found" panel so the user can
 * tell at a glance whether each source contributed data.
 */
export type FetchInventoryItem = {
  readonly source: string;
  /** 'ok' = got data; 'empty' = successful but no data; 'error' = failed */
  readonly status: 'ok' | 'empty' | 'error';
  readonly count: number;
  readonly error?: string;
};

/** Result of a single pipeline run (one record). */
export type RunResult = {
  readonly runId: string;
  readonly recordId: string;
  readonly objectType: SfObject;
  readonly status: 'completed' | 'failed';
  readonly dryRun: boolean;
  readonly fieldsExtracted: number;
  readonly fieldsWritten: number;
  readonly fieldsSkipped: number;
  readonly fieldsErrored: number;
  readonly fetchErrors: readonly { source: string; error: string }[];
  readonly batchErrors: readonly { batchId: string; error: string }[];
  readonly phaseTimings: readonly PhaseTiming[];
  readonly batchExecutions: readonly BatchExecution[];
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly durationMs: number;
  readonly error?: string;
};

/** Result of a batch pipeline run (multiple records). */
export type BatchResult = {
  readonly batchId: string;
  readonly totalRecords: number;
  readonly completedRecords: number;
  readonly failedRecords: number;
  readonly runs: readonly RunResult[];
  readonly durationMs: number;
};

/** Events emitted during pipeline execution (for SSE streaming). */
export type PipelineEvent =
  | { readonly type: 'phase'; readonly phase: string; readonly status: 'started' | 'done' }
  | { readonly type: 'fetch_result'; readonly source: string; readonly ok: boolean; readonly error?: string }
  | { readonly type: 'extraction'; readonly fieldName: string; readonly value: string | null; readonly confidence: number; readonly wasWritten: boolean }
  | { readonly type: 'batch_progress'; readonly completedRecords: number; readonly totalRecords: number }
  | { readonly type: 'done'; readonly runId: string; readonly summary: { extracted: number; written: number; skipped: number; errored: number } }
  | { readonly type: 'error'; readonly error: string };
