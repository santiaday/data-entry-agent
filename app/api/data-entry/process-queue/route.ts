/**
 * GET /api/data-entry/process-queue — RETIRED.
 *
 * Queue draining moved to revops-agents (cron-driver), which now drains
 * runs.dispatch_queue directly. This endpoint no longer processes anything
 * and always returns HTTP 410 Gone.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return Response.json(
    {
      error:
        'Queue draining moved to revops-agents (cron-driver). This endpoint is retired.',
      code: 'GONE',
    },
    { status: 410 },
  );
}
