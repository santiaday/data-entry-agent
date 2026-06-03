/** UI types for the Data Entry Agent pages. */

export type BatchListItem = {
  id: string;
  trigger_type: string;
  soql_query: string | null;
  object_type: string;
  dry_run: boolean;
  status: string;
  total_records: number;
  completed_records: number;
  failed_records: number;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
};

export type RunListItem = {
  id: string;
  record_id: string;
  object_type: string;
  status: string;
  dry_run: boolean;
  fields_extracted: number;
  fields_written: number;
  fields_skipped: number;
  fields_errored: number;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
};

export type PhaseTimingRow = {
  phase: string;
  durationMs: number;
};

export type BatchExecutionRow = {
  batchId: string;
  durationMs: number;
  promptTokens: number;
  completionTokens: number;
  status: 'success' | 'error';
  error?: string;
};

export type ExtractionRow = {
  id: string;
  field_name: string;
  sf_object: string;
  batch_id: string;
  extracted_value: string | null;
  current_sf_value: string | null;
  actual_sf_value_after_write: string | null;
  write_mode: string;
  confidence: number | null;
  evidence: string | null;
  was_written: boolean;
  skip_reason: string | null;
  validation_errors: string[] | null;
  created_at: string;
};

export type WriteResultRow = {
  objectType: string;
  recordId: string;
  fieldsAttempted: number;
  fieldsVerifiedWritten: number;
  silentlyDropped: number;
  error: string | null;
};

export type FetchInventoryRow = {
  source: string;
  status: 'ok' | 'empty' | 'error';
  count: number;
  error?: string;
};

export type QueueItem = {
  id: string;
  record_id: string;
  object_type: string;
  trigger_event: string;
  scheduled_at: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  run_id: string | null;
  delay_minutes: number;
  created_at: string;
  processed_at: string | null;
};

export type HistoryRow =
  | { kind: 'batch'; data: BatchListItem }
  | { kind: 'queued'; data: QueueItem };

export type StreamEvent =
  | { type: 'phase'; phase: string; status: string }
  | { type: 'fetch_result'; source: string; ok: boolean; error?: string }
  | { type: 'extraction'; fieldName: string; value: string | null; confidence: number; wasWritten: boolean }
  | { type: 'done'; runId: string; summary: { extracted: number; written: number; skipped: number; errored: number } }
  | { type: 'error'; error: string }
  | { type: 'result'; runId: string; status: string; [key: string]: unknown };
