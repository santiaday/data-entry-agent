/**
 * GET  /api/data-entry/fields — List all active field configs (seeds from code on first call).
 * POST /api/data-entry/fields — Create a new field config.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { BATCH_CONFIGS, loadFieldConfigs, seedFieldConfigsFromCode } from '@/lib/pipeline';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.permissions.modules.data_entry.access) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const supabase = createServiceClient();

  // Ensure seed exists, then query the table directly so the UI gets
  // every row (including inactive, for admin view) plus the DB id.
  try {
    await loadFieldConfigs(supabase, ctx.orgId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Seed failed', code: 'SEED_FAILED' },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from('de_field_configs')
    .select('id, config_id, sf_object, field_name, value_type, batch_id, instruction, write_mode, options, validation, is_active, created_at, updated_at')
    .eq('org_id', ctx.orgId)
    .order('batch_id', { ascending: true })
    .order('sf_object', { ascending: true })
    .order('field_name', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message, code: 'QUERY_FAILED' }, { status: 500 });
  }

  return NextResponse.json({
    fields: data ?? [],
    batches: BATCH_CONFIGS,
    totalFields: data?.length ?? 0,
  });
}

const createSchema = z.object({
  configId: z.string().min(1).max(100).regex(/^[a-z0-9_]+$/, 'Use lowercase letters, digits, and underscores only'),
  sfObject: z.enum(['Lead', 'Opportunity']),
  fieldName: z.string().min(1).max(100).regex(/__c$/, 'Custom field names must end with __c'),
  valueType: z.enum(['picklist', 'multipicklist', 'text', 'textarea', 'number', 'date', 'datetime', 'boolean']),
  batchId: z.string().min(1),
  instruction: z.string().min(10).max(5000),
  writeMode: z.enum(['overwrite', 'fill_blank', 'append']),
  options: z.array(z.string()).optional(),
  validation: z.object({
    maxLength: z.number().int().positive().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    dateFormat: z.enum(['YYYY-MM-DD', 'YYYY-MM-DDTHH:MM:SSZ']).optional(),
  }).optional(),
});

export async function POST(request: Request) {
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message, code: 'INVALID_REQUEST' }, { status: 400 });
  }

  const supabase = createServiceClient();
  const input = parsed.data;

  const { data, error } = await supabase
    .from('de_field_configs')
    .insert({
      org_id: ctx.orgId,
      user_id: ctx.userId,
      config_id: input.configId,
      sf_object: input.sfObject,
      field_name: input.fieldName,
      value_type: input.valueType,
      batch_id: input.batchId,
      instruction: input.instruction,
      write_mode: input.writeMode,
      options: input.options ?? null,
      validation: input.validation ?? null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message, code: 'CREATE_FAILED' }, { status: 500 });
  }

  return NextResponse.json({ field: data }, { status: 201 });
}
