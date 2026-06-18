/**
 * POST /api/data-entry/run — Enqueue a single Data Entry Agent run.
 *
 * Thin trigger: validates the request and inserts ONE row into
 * runs.dispatch_queue. The cron-driver drains the queue and executes the
 * actual extraction; the UI never runs the pipeline itself.
 */

import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { AGENT_REF, jsonError } from '@/lib/revops/mappers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  recordId: z.string().regex(/^[A-Za-z0-9]{15,18}$/, 'Invalid Salesforce record id'),
  objectType: z.enum(['Lead', 'Opportunity']),
  dryRun: z.boolean().optional().default(true),
  fieldGroups: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return jsonError('Unauthorized', 401);

  const dePerms = ctx.permissions.modules.data_entry;
  if (!dePerms.access) return jsonError('Forbidden', 403);
  if (!dePerms.can_run_batches) return jsonError('Forbidden', 403);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(`Invalid request: ${parsed.error.message}`, 400);
  }

  const { recordId, objectType, dryRun, fieldGroups } = parsed.data;
  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from('runs.dispatch_queue')
    .insert({
      agent_ref: AGENT_REF,
      subject_id: recordId,
      subject_kind: objectType,
      payload: {
        record_id: recordId,
        record_type: objectType,
        dry_run: dryRun,
        field_groups: fieldGroups ?? null,
      },
      dry_run: dryRun,
      enqueued_by: ctx.email ?? 'ui',
    })
    .select('id')
    .single();

  if (error) {
    return jsonError(`Failed to enqueue run: ${error.message}`, 500);
  }

  if (!data) {
    return jsonError('Failed to enqueue run', 500);
  }

  return Response.json({ queued: true, id: data.id, dry_run: dryRun });
}
