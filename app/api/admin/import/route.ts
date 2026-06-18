/**
 * POST /api/admin/import — DISABLED.
 *
 * Bulk import is no longer applicable in the revops-backed model: the UI does
 * not own the database, so it cannot load data into it. Returns HTTP 410 Gone.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return Response.json(
    {
      error: 'Bulk import is disabled in the revops-backed model; the UI does not own the database.',
      code: 'GONE',
    },
    { status: 410 },
  );
}
