/**
 * GET /api/data-entry/batches/[id] — Batch detail.
 *
 * Batches are not a first-class concept in the revops-backed schema (there is
 * no de_batches table). A run aggregates extractions across many group_keys, so
 * there is no single record that reconstructs the old { batch, runs, stats }
 * shape without fabricating data. We therefore return a clear 404 rather than
 * inventing a batch. Run-level detail remains available via /runs/[id].
 */

import { getAuthContext } from '@/lib/auth';
import { jsonError } from '@/lib/revops/mappers';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params;

  const ctx = await getAuthContext();
  if (!ctx) return jsonError('Unauthorized', 401, 'UNAUTHORIZED');
  if (!ctx.permissions.modules.data_entry.access) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  return jsonError('Batch view is not available in the revops-backed model', 404, 'NOT_FOUND');
}
