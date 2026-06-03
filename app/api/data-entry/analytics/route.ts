/**
 * GET /api/data-entry/analytics
 *
 * Aggregate skip-reason analytics across all extractions, so you can see
 * which fields are getting skipped the most and WHY.
 *
 * Query params:
 *   ?days=N           — look back N days (default: 30)
 *   ?objectType=Lead  — filter to one SF object (optional)
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!ctx.permissions.modules.data_entry.can_view_analytics) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10), 1), 365);
  const objectType = searchParams.get('objectType');

  const supabase = createServiceClient();
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // ── Pagination ──────────────────────────────────────
  // Supabase's PostgREST layer caps responses at 1000 rows by default
  // (the `max-rows` setting). .limit(100_000) does not override this —
  // it's a server-side hard ceiling. So we paginate via .range() until
  // we've pulled everything. Hard cap at 100k rows for safety; beyond
  // that we'd need a Postgres RPC for server-side aggregation.
  const PAGE_SIZE = 1000;
  const HARD_CAP = 100_000;
  type ExtRow = {
    field_name: string;
    sf_object: string;
    batch_id: string;
    was_written: boolean;
    skip_reason: string | null;
    validation_errors: string[] | null;
    confidence: number | null;
    created_at: string;
  };

  const extractions: ExtRow[] = [];

  for (let offset = 0; offset < HARD_CAP; offset += PAGE_SIZE) {
    let query = supabase
      .from('de_extractions')
      .select('field_name, sf_object, batch_id, was_written, skip_reason, validation_errors, confidence, created_at')
      .eq('org_id', ctx.orgId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (objectType) {
      query = query.eq('sf_object', objectType);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message, code: 'QUERY_FAILED' }, { status: 500 });
    }

    const page = (data ?? []) as ExtRow[];
    extractions.push(...page);

    // Done when the page returned fewer rows than requested
    if (page.length < PAGE_SIZE) break;
  }

  // ── Aggregate 1: skip reasons across all extractions ──
  const skipReasonCounts = new Map<string, number>();
  // ── Aggregate 2: per-field stats ──
  type FieldStat = {
    fieldName: string;
    sfObject: string;
    batchId: string;
    totalAttempts: number;
    written: number;
    skipped: number;
    errored: number;
    skipReasons: Record<string, number>;
    avgConfidence: number;
    confidenceSum: number;
    confidenceCount: number;
  };
  const perField = new Map<string, FieldStat>();
  // ── Aggregate 3: confidence distribution ──
  const confidenceBuckets = { high: 0, medium: 0, low: 0, null: 0 };

  for (const ext of extractions) {
    // Skip-reason counts
    if (!ext.was_written && ext.skip_reason) {
      skipReasonCounts.set(ext.skip_reason, (skipReasonCounts.get(ext.skip_reason) ?? 0) + 1);
    }

    // Per-field stats
    const key = `${ext.sf_object}|${ext.field_name}`;
    if (!perField.has(key)) {
      perField.set(key, {
        fieldName: ext.field_name,
        sfObject: ext.sf_object,
        batchId: ext.batch_id,
        totalAttempts: 0,
        written: 0,
        skipped: 0,
        errored: 0,
        skipReasons: {},
        avgConfidence: 0,
        confidenceSum: 0,
        confidenceCount: 0,
      });
    }
    const stat = perField.get(key)!;
    stat.totalAttempts++;
    if (ext.was_written) {
      stat.written++;
    } else {
      if (ext.validation_errors && ext.validation_errors.length > 0) {
        stat.errored++;
      } else {
        stat.skipped++;
      }
      if (ext.skip_reason) {
        stat.skipReasons[ext.skip_reason] = (stat.skipReasons[ext.skip_reason] ?? 0) + 1;
      }
    }
    if (typeof ext.confidence === 'number') {
      stat.confidenceSum += ext.confidence;
      stat.confidenceCount++;
    }

    // Confidence distribution
    if (typeof ext.confidence !== 'number') {
      confidenceBuckets.null++;
    } else if (ext.confidence >= 0.9) {
      confidenceBuckets.high++;
    } else if (ext.confidence >= 0.7) {
      confidenceBuckets.medium++;
    } else {
      confidenceBuckets.low++;
    }
  }

  // Finalize averages
  const perFieldArray = [...perField.values()].map((stat) => ({
    ...stat,
    avgConfidence: stat.confidenceCount > 0 ? stat.confidenceSum / stat.confidenceCount : 0,
    // Compute skip rate for sorting
    skipRate: stat.totalAttempts > 0 ? (stat.skipped + stat.errored) / stat.totalAttempts : 0,
  }));

  // Tell the UI if we hit the pagination cap so it can warn the user.
  const hitCap = extractions.length >= HARD_CAP;

  return NextResponse.json({
    period: { days, since: sinceIso },
    truncated: hitCap,
    hardCap: HARD_CAP,
    totals: {
      extractions: extractions.length,
      written: extractions.filter((e) => e.was_written).length,
      skipped: extractions.filter((e) => !e.was_written && (!e.validation_errors || e.validation_errors.length === 0)).length,
      errored: extractions.filter((e) => e.validation_errors && e.validation_errors.length > 0).length,
    },
    skipReasons: [...skipReasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    perField: perFieldArray.sort((a, b) => {
      // Primary: by total skip+error count descending (most problematic first)
      const aSkipTotal = a.skipped + a.errored;
      const bSkipTotal = b.skipped + b.errored;
      if (aSkipTotal !== bSkipTotal) return bSkipTotal - aSkipTotal;
      return b.totalAttempts - a.totalAttempts;
    }),
    confidenceDistribution: confidenceBuckets,
  });
}
