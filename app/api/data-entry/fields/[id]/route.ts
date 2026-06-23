/**
 * PUT    /api/data-entry/fields/[id] — Update a field config (partial).
 * DELETE /api/data-entry/fields/[id] — Soft delete (sets is_active = false).
 *
 * [id] is the config.field_definitions surrogate id (row.id), re-attached by the
 * list route (fields/route.ts) and used by the client for edit/delete — NOT the
 * field_key. Rows live in config.field_definitions and are scoped by
 * agent_ref = AGENT_REF (there is no org_id). Both verbs require can_edit_fields.
 */

import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';
import { AGENT_REF, jsonError, mapField } from '@/lib/revops/mappers';
import { withRevops, mapDbWriteError } from '@/lib/revops/with-revops';
import { VALUE_TYPES } from '@/lib/revops/field-constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  instruction: z.string().min(10).max(5000).optional(),
  writeMode: z.enum(['overwrite', 'fill_blank', 'append']).optional(),
  valueType: z.enum(VALUE_TYPES).optional(),
  batchId: z.string().min(1).optional(),
  options: z.array(z.string()).nullable().optional(),
  validation: z
    .object({
      maxLength: z.number().int().positive().optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      dateFormat: z.enum(['YYYY-MM-DD', 'YYYY-MM-DDTHH:MM:SSZ']).optional(),
    })
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const PUT = withRevops(async (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

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

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.message, 400, 'INVALID_REQUEST');
  }

  const input = parsed.data;
  const supabase = createServiceClient();

  // Build dynamic update — only include columns that were provided.
  // The table's updated_at has a now() default but no trigger, so set it here.
  const update: Record<string, unknown> = {
    updated_by: ctx.email ?? 'system',
    updated_at: new Date().toISOString(),
  };
  if (input.instruction !== undefined) update.instruction = input.instruction;
  if (input.writeMode !== undefined) update.write_mode = input.writeMode;
  if (input.valueType !== undefined) update.value_type = input.valueType;
  if (input.batchId !== undefined) update.group_key = input.batchId;
  if (input.options !== undefined) update.options = input.options;
  if (input.validation !== undefined) update.validation = input.validation;
  if (input.isActive !== undefined) update.is_active = input.isActive;
  if (input.sortOrder !== undefined) update.sort_order = input.sortOrder;

  const { data, error } = await supabase
    .from('config.field_definitions')
    .update(update)
    .eq('agent_ref', AGENT_REF)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return mapDbWriteError(
      error,
      'A field with that key already exists',
      'Failed to update field',
      'UPDATE_FAILED',
    );
  }
  if (!data) {
    return jsonError('Field not found', 404, 'NOT_FOUND');
  }

  return Response.json({ field: mapField(data) });
});

export const DELETE = withRevops(async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;

  const ctx = await getAuthContext();
  if (!ctx.permissions.modules.data_entry.can_edit_fields) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const supabase = createServiceClient();

  // Soft delete — flip is_active off so runtime skips it but history is preserved.
  const { error } = await supabase
    .from('config.field_definitions')
    .update({
      is_active: false,
      updated_by: ctx.email ?? 'system',
      updated_at: new Date().toISOString(),
    })
    .eq('agent_ref', AGENT_REF)
    .eq('id', id);

  if (error) {
    return mapDbWriteError(
      error,
      'A field with that key already exists',
      'Failed to delete field',
      'DELETE_FAILED',
    );
  }

  return Response.json({ success: true });
});
