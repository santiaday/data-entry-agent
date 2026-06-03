/**
 * PUT    /api/data-entry/fields/[id] — Update a field config (partial).
 * DELETE /api/data-entry/fields/[id] — Soft delete (sets is_active = false).
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  instruction: z.string().min(10).max(5000).optional(),
  writeMode: z.enum(['overwrite', 'fill_blank', 'append']).optional(),
  valueType: z.enum(['picklist', 'multipicklist', 'text', 'textarea', 'number', 'date', 'datetime', 'boolean']).optional(),
  batchId: z.string().min(1).optional(),
  options: z.array(z.string()).nullable().optional(),
  validation: z.object({
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    dateFormat: z.enum(['YYYY-MM-DD', 'YYYY-MM-DDTHH:MM:SSZ']).optional(),
  }).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.permissions.modules.data_entry.can_edit_fields) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message, code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const input = parsed.data;

  // Build dynamic update — only include fields that were provided
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.instruction !== undefined) update.instruction = input.instruction;
  if (input.writeMode !== undefined) update.write_mode = input.writeMode;
  if (input.valueType !== undefined) update.value_type = input.valueType;
  if (input.batchId !== undefined) update.batch_id = input.batchId;
  if (input.options !== undefined) update.options = input.options;
  if (input.validation !== undefined) update.validation = input.validation;
  if (input.isActive !== undefined) update.is_active = input.isActive;

  const { data, error } = await supabase
    .from('de_field_configs')
    .update(update)
    .eq('id', id)
    .eq('org_id', ctx.orgId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message, code: 'UPDATE_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ field: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.permissions.modules.data_entry.can_edit_fields) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const supabase = createServiceClient();

  // Soft delete — flip is_active off so runtime skips it but history is preserved.
  const { error } = await supabase
    .from('de_field_configs')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('org_id', ctx.orgId);

  if (error) {
    return NextResponse.json({ error: error.message, code: 'DELETE_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
