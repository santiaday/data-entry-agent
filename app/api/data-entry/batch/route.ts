/**
 * POST /api/data-entry/batch — Thin bulk-enqueue of records.
 *
 * The UI can no longer reach Salesforce, so it does NOT resolve SOQL cohorts or
 * execute extraction. This route simply enqueues one runs.dispatch_queue row per
 * record id (same shape as the single-record run route); the revops-agents
 * cron-driver drains the queue and runs the pipeline.
 *
 * SOQL-cohort resolution is a backend/local-tool concern now. If the client still
 * sends a `soql`/`soqlQuery`, we reject with a clear message.
 *
 * Requires can_run_batches.
 */

import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { AGENT_REF, jsonError } from '@/lib/revops/mappers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Salesforce IDs are 15 or 18 chars, alphanumeric.
const SF_ID = /^[A-Za-z0-9]{15,18}$/;

const requestSchema = z.object({
  recordIds: z
    .array(z.string())
    .min(1)
    .transform((ids) => ids.filter((id) => SF_ID.test(id))),
  objectType: z.enum(['Lead', 'Opportunity']),
  dryRun: z.boolean().optional().default(true),
  fieldGroups: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx.email) return jsonError('Unauthorized', 401, 'UNAUTHORIZED');
  const dePerms = ctx.permissions.modules.data_entry;
  if (!dePerms.access) return jsonError('Forbidden', 403, 'FORBIDDEN');
  if (!dePerms.can_run_batches) return jsonError('Forbidden', 403, 'FORBIDDEN');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400, 'INVALID_REQUEST');
  }

  // SOQL-cohort batches are resolved by the backend/local tool now.
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (b.soql != null || b.soqlQuery != null) {
      return jsonError(
        'SOQL cohort batches are resolved by the backend/local tool now; pass recordIds[] instead',
        400,
        'INVALID_REQUEST',
      );
    }
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(`Invalid request: ${parsed.error.message}`, 400, 'INVALID_REQUEST');
  }

  const { recordIds, objectType, dryRun, fieldGroups } = parsed.data;

  if (recordIds.length === 0) {
    return jsonError('No valid record ids (expected 15–18 alphanumeric)', 400, 'NO_RECORDS');
  }

  const supabase = createServiceClient();

  const rows = recordIds.map((recordId) => ({
    agent_ref: AGENT_REF,
    subject_id: recordId,
    subject_kind: objectType,
    payload: {
      record_id: recordId,
      record_type: objectType,
      dry_run: dryRun,
      ...(fieldGroups ? { field_groups: fieldGroups } : {}),
    },
    dry_run: dryRun,
    enqueued_by: ctx.email,
  }));

  const { error } = await supabase
    .from('runs.dispatch_queue')
    .insert(rows)
    .select('id');

  if (error) {
    return jsonError(error.message, 500, 'ENQUEUE_FAILED');
  }

  return Response.json({ queued: recordIds.length });
}
