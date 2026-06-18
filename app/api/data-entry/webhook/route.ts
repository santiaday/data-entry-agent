/**
 * POST /api/data-entry/webhook — OBSOLETE.
 *
 * Salesforce webhook intake is now handled by revops-agents' API Gateway,
 * because DeployBay cannot receive Apex callouts. This endpoint returns
 * HTTP 410 Gone; point Apex at the revops webhooks endpoint instead.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  return Response.json(
    {
      error:
        'Salesforce webhook intake moved to revops-agents. Point Apex at the revops webhooks endpoint.',
      code: 'GONE',
    },
    { status: 410 },
  );
}
