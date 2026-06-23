/**
 * Shared mapping between revops-db rows (config.* / runs.*) and the UI shapes
 * the React components expect. Centralized so every route maps consistently.
 */

export const AGENT_REF = process.env.AGENT_REF ?? 'sales/data-entry-agent';

/**
 * Allowed config.field_definitions.value_type values. Single source of truth so
 * the create and update field schemas (and the UI) accept the identical set.
 */
export const FIELD_VALUE_TYPES = [
  'picklist',
  'multipicklist',
  'text',
  'textarea',
  'number',
  'currency',
  'date',
  'datetime',
  'boolean',
] as const;

export function jsonError(message: string, status: number, code = 'ERROR') {
  return Response.json({ error: message, code }, { status });
}

/** New schema stores confidence as text; the UI's ExtractionRow wants a number. */
export function confidenceToNumber(c: unknown): number | null {
  switch (String(c ?? '').toLowerCase()) {
    case 'high': return 0.95;
    case 'medium': return 0.75;
    case 'low': return 0.4;
    default: return null;
  }
}

// ── runs.agent_runs → RunListItem ─────────────────────────────────
export function mapRun(row: Record<string, any>, counts?: {
  extracted?: number; written?: number; skipped?: number; errored?: number;
}) {
  const tp = (row.trigger_payload ?? {}) as Record<string, any>;
  return {
    id: row.run_id ?? row.id,
    record_id: row.subject_id ?? tp.record_id ?? null,
    object_type: tp.record_type ?? row.subject_kind ?? null,
    status: row.status,
    dry_run: tp.dry_run === true || tp.dry_run === 'true',
    fields_extracted: counts?.extracted ?? 0,
    fields_written: counts?.written ?? 0,
    fields_skipped: counts?.skipped ?? 0,
    fields_errored: counts?.errored ?? 0,
    duration_ms: row.duration_ms ?? null,
    started_at: row.started_at ?? null,
    completed_at: row.ended_at ?? null,
    error: row.error ? (typeof row.error === 'string' ? row.error : (row.error.message ?? JSON.stringify(row.error))) : null,
    created_at: row.started_at ?? row.created_at ?? null,
  };
}

// ── runs.field_extractions → ExtractionRow ────────────────────────
export function mapExtraction(row: Record<string, any>) {
  return {
    id: String(row.id),
    field_name: row.field_api_name,
    field_key: row.field_key,
    sf_object: row.sf_object,
    batch_id: row.group_key ?? '',
    extracted_value: row.extracted_value ?? null,
    current_sf_value: row.before_value ?? null,
    actual_sf_value_after_write: row.after_value ?? null,
    write_mode: row.write_mode ?? 'overwrite',
    confidence: confidenceToNumber(row.confidence),
    confidence_label: row.confidence ?? null,
    evidence: row.evidence ?? null,
    was_written: row.write_outcome === 'written',
    write_outcome: row.write_outcome ?? null,
    skip_reason: row.skip_reason ?? null,
    validation_errors: Array.isArray(row.validation_errors) ? row.validation_errors : null,
    dry_run: row.dry_run === true,
    created_at: row.created_at ?? null,
  };
}

/** Roll up extraction rows into the per-run counts the UI shows. */
export function extractionCounts(rows: Array<{ write_outcome?: string | null }>) {
  let extracted = 0, written = 0, skipped = 0, errored = 0;
  for (const r of rows) {
    const o = r.write_outcome ?? '';
    if (o !== 'skipped_no_value') extracted++;
    if (o === 'written') written++;
    else if (o === 'invalid' || o === 'sf_rejected' || o === 'write_silently_dropped' || o === 'write_failed') errored++;
    else skipped++;
  }
  return { extracted, written, skipped, errored };
}

// ── runs.dispatch_queue → QueueItem ───────────────────────────────
export function mapQueue(row: Record<string, any>) {
  const tp = (row.payload ?? {}) as Record<string, any>;
  return {
    id: String(row.id),
    record_id: row.subject_id ?? tp.record_id ?? null,
    object_type: tp.record_type ?? row.subject_kind ?? null,
    trigger_event: row.enqueued_by ?? 'manual',
    scheduled_at: row.enqueued_at ?? null,
    status: row.status,
    attempts: row.attempts ?? 0,
    max_attempts: row.max_attempts ?? 3,
    last_error: row.last_error ?? null,
    run_id: row.dispatched_run_id ?? null,
    delay_minutes: 0,
    created_at: row.enqueued_at ?? null,
    processed_at: TERMINAL_QUEUE_STATUSES.has(row.status) ? (row.updated_at ?? null) : null,
    dry_run: row.dry_run === true,
  };
}

/** dispatch_queue statuses that represent a completed/finished row. */
const TERMINAL_QUEUE_STATUSES = new Set(['dispatched', 'failed', 'cancelled', 'dead']);

// ── config.field_definitions → FieldConfig (UI) ───────────────────
export function mapField(row: Record<string, any>) {
  return {
    config_id: row.field_key,
    field_key: row.field_key,
    sf_object: row.sf_object,
    field_name: row.field_api_name,
    value_type: row.value_type,
    batch_id: row.group_key,
    write_mode: row.write_mode,
    instruction: row.instruction ?? '',
    options: Array.isArray(row.options) ? row.options : (row.options ?? null),
    validation: row.validation ?? null,
    is_active: row.is_active !== false,
    sort_order: row.sort_order ?? 0,
    per_contact: row.per_contact === true,
  };
}

/** Derive a stable field_key for a NEW field added from the UI. */
export function deriveFieldKey(sfObject: string, fieldApiName: string): string {
  return `${String(sfObject).toLowerCase()}.${String(fieldApiName).toLowerCase()}`;
}

// ── config.prompt_versions (slot pair) → UI prompt version ────────
export interface PromptSlotRow {
  id: number | string;
  slot: string;
  version: number;
  body: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

/** Merge 'system' + 'extraction' slot rows (same version) into the UI shape. */
export function mergePromptVersions(rows: PromptSlotRow[]) {
  const byVersion = new Map<number, { system?: PromptSlotRow; extraction?: PromptSlotRow }>();
  for (const r of rows) {
    const v = byVersion.get(r.version) ?? {};
    if (r.slot === 'system') v.system = r;
    else if (r.slot === 'extraction') v.extraction = r;
    byVersion.set(r.version, v);
  }
  return [...byVersion.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([version, slots]) => ({
      id: String(slots.system?.id ?? slots.extraction?.id ?? version),
      name: 'data-entry',
      version,
      system_prompt: slots.system?.body ?? '',
      user_prompt_preamble: slots.extraction?.body ?? '',
      is_active: !!(slots.system?.is_active || slots.extraction?.is_active),
      notes: slots.system?.notes ?? slots.extraction?.notes ?? null,
      created_at: slots.system?.created_at ?? slots.extraction?.created_at ?? null,
    }));
}
