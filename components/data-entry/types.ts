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

export type ExtractionRow = {
  id: string;
  field_key: string;
  field_name: string;
  sf_object: string;
  batch_id: string;
  extracted_value: string | null;
  current_sf_value: string | null;
  actual_sf_value_after_write: string | null;
  write_mode: string;
  confidence: number | null;
  confidence_label: string | null;
  evidence: string | null;
  was_written: boolean;
  write_outcome: string | null;
  skip_reason: string | null;
  validation_errors: string[] | null;
  dry_run: boolean;
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
