/**
 * GET  /api/data-entry/fields — List field configs for this agent (config.field_definitions).
 * POST /api/data-entry/fields — Create a new field config (requires can_edit_fields).
 *
 * Backed by config.field_definitions scoped by agent_ref = AGENT_REF (no org_id).
 * Rows are mapped to the legacy UI shape via mapField(); the DB `id` is preserved
 * on each row so the [id] PUT/DELETE routes keep working.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';
import { AGENT_REF, jsonError, mapField, deriveFieldKey } from '@/lib/revops/mappers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Columns selected for the UI projection. */
const FIELD_COLUMNS =
  'id, field_key, sf_object, field_api_name, value_type, group_key, write_mode, instruction, options, validation, is_active, sort_order, per_contact, updated_at';

/**
 * Derive the legacy `batches` payload ({ batchId, label }[]) from the distinct
 * group_key values present, so the client's batch filter/grouping still works
 * without depending on the removed @/lib/pipeline BATCH_CONFIGS constant.
 */
function deriveBatches(rows: Array<{ group_key?: string | null }>) {
  const seen = new Set<string>();
  const batches: Array<{ batchId: string; label: string }> = [];
  for (const r of rows) {
    const id = r.group_key ?? '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    batches.push({ batchId: id, label: id });
  }
  return batches.sort((a, b) => a.batchId.localeCompare(b.batchId));
}

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx.permissions.modules.data_entry.access) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('config.field_definitions')
    .select(FIELD_COLUMNS)
    .eq('agent_ref', AGENT_REF)
    .order('sort_order', { ascending: true });

  if (error) {
    return jsonError(error.message, 500, 'QUERY_FAILED');
  }

  const rows = data ?? [];
  // mapField() drops the DB id; re-attach it so [id] edit/delete keep working.
  const fields = rows.map((row) => ({ ...mapField(row), id: row.id }));

  return NextResponse.json({
    fields,
    batches: deriveBatches(rows),
    totalFields: fields.length,
  });
}

/**
 * The React form (FieldConfigBrowser) posts camelCase keys. Accept those and
 * map them onto the config.field_definitions columns. is_active / sort_order
 * are optional (the form does not send them) and fall back to the defaults.
 */
const createSchema = z.object({
  configId: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, digits, and underscores only').optional(),
  sfObject: z.enum(['Lead', 'Opportunity']),
  fieldName: z.string().min(1).max(100).regex(/__c$/, 'Custom field names must end with __c'),
  valueType: z.enum(['picklist', 'multipicklist', 'text', 'textarea', 'number', 'date', 'datetime', 'boolean']),
  batchId: z.string().min(1),
  instruction: z.string().min(10).max(5000),
  writeMode: z.enum(['overwrite', 'fill_blank', 'append']),
  options: z.array(z.string()).optional(),
  validation: z
    .object({
      maxLength: z.number().int().positive().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      dateFormat: z.enum(['YYYY-MM-DD', 'YYYY-MM-DDTHH:MM:SSZ']).optional(),
    })
    .optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx.permissions.modules.data_entry.can_edit_fields) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400, 'INVALID_REQUEST');
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.message, 400, 'INVALID_REQUEST');
  }

  const supabase = createServiceClient();
  const input = parsed.data;

  const { data, error } = await supabase
    .from('config.field_definitions')
    .insert({
      agent_ref: AGENT_REF,
      field_key: deriveFieldKey(input.sfObject, input.fieldName),
      sf_object: input.sfObject,
      field_api_name: input.fieldName,
      value_type: input.valueType,
      group_key: input.batchId,
      write_mode: input.writeMode,
      instruction: input.instruction,
      options: input.options ?? null,
      validation: input.validation ?? null,
      is_active: input.isActive !== false,
      sort_order: input.sortOrder ?? 0,
      updated_by: ctx.email ?? 'system',
    })
    .select()
    .single();

  if (error) {
    return jsonError(error.message, 500, 'CREATE_FAILED');
  }

  return NextResponse.json({ field: { ...mapField(data), id: data.id } }, { status: 201 });
}
