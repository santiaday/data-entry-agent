/**
 * POST /api/data-entry/webhook — Receive Salesforce APEX trigger webhooks.
 *
 * Validates the bearer token, checks for duplicates, and queues the record
 * for processing after a configurable delay (default 2 hours to allow Gong
 * call processing to complete).
 *
 * This route is excluded from session-based auth in middleware — it uses
 * a shared secret (WEBHOOK_SECRET) instead.
 */

import { z } from 'zod';
import { NextResponse } from 'next/server';
import { DEFAULT_ORG_ID } from '@/lib/constants';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_DELAY_MINUTES = 120; // 2 hours for Gong processing

const webhookSchema = z.object({
  recordId: z.string().min(15).max(18),
  objectType: z.enum(['Lead', 'Opportunity']),
  event: z.enum(['after_insert', 'after_update', 'manual']).default('after_insert'),
  delayMinutes: z.number().int().min(0).max(1440).optional(),
});

export async function POST(request: Request) {
  // ── Auth: bearer token ──────────────────────────────────────
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] WEBHOOK_SECRET not configured');
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 },
    );
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ──────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid payload: ${parsed.error.message}` },
      { status: 400 },
    );
  }

  const { recordId, objectType, event, delayMinutes } = parsed.data;
  const delay = delayMinutes ?? DEFAULT_DELAY_MINUTES;

  const supabase = createServiceClient();

  // ── Queue the job (unique index prevents duplicates at DB level) ─
  const scheduledAt = new Date(Date.now() + delay * 60_000).toISOString();

  const { data: job, error: insertErr } = await supabase
    .from('data_entry_queue')
    .insert({
      org_id: DEFAULT_ORG_ID,
      record_id: recordId,
      object_type: objectType,
      trigger_event: event,
      trigger_payload: body,
      delay_minutes: delay,
      scheduled_at: scheduledAt,
    })
    .select('id')
    .single();

  if (insertErr) {
    // Unique constraint violation → duplicate record already queued
    if (insertErr.code === '23505') {
      return NextResponse.json({
        queued: false,
        reason: 'duplicate',
      });
    }
    console.error('[webhook] Failed to queue job:', insertErr.message);
    return NextResponse.json(
      { error: 'Failed to queue job' },
      { status: 500 },
    );
  }

  if (!job) {
    return NextResponse.json(
      { error: 'Failed to queue job' },
      { status: 500 },
    );
  }

  console.log(
    `[webhook] Queued ${objectType} ${recordId} (event=${event}, delay=${delay}m, scheduled=${scheduledAt})`,
  );

  return NextResponse.json({
    queued: true,
    jobId: job.id,
    scheduledAt,
    delayMinutes: delay,
  });
}
