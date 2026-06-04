/**
 * POST /api/data-entry/run — Run the Data Entry Agent for a single record.
 *
 * Returns an SSE stream with per-phase and per-field progress events.
 */

import { z } from 'zod';
import { getAuthContext } from '@/lib/auth';
import { SalesforceTokenCache } from '@/lib/sf';
import { runPipeline, type PipelineEvent } from '@/lib/pipeline';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const tokenCache = new SalesforceTokenCache();

const requestSchema = z.object({
  recordId: z.string().min(15).max(18),
  objectType: z.enum(['Lead', 'Opportunity']),
  dryRun: z.boolean().optional().default(false),
  fieldBatches: z.array(z.string()).optional(),
  fieldNames: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return jsonError('Unauthorized', 401);
  const dePerms = ctx.permissions.modules.data_entry;
  if (!dePerms.access || !dePerms.can_run_batches) {
    return jsonError('Forbidden', 403);
  }

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

  const { recordId, objectType, dryRun, fieldBatches, fieldNames } = parsed.data;
  const supabase = createServiceClient();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: PipelineEvent | Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        const result = await runPipeline({
          input: {
            recordId,
            objectType,
            orgId: ctx.orgId,
            userId: ctx.userId,
            dryRun,
            fieldBatches,
            fieldNames,
          },
          supabase,
          tokenCache,
          onEvent: send,
        });

        // The pipeline already emits a 'done' event, but include the full result
        send({ type: 'result', ...result });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        send({ type: 'error', error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

function jsonError(message: string, status: number) {
  return Response.json({ error: message, code: 'INVALID_REQUEST' }, { status });
}
