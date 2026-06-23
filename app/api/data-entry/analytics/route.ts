/**
 * GET /api/data-entry/analytics
 *
 * Aggregate skip-reason analytics across all extractions for this agent, so you
 * can see which fields are getting skipped the most and WHY.
 *
 * Reads runs.field_extractions (scoped by agent_ref) and aggregates server-side
 * via GROUP BY (revopsQuery) instead of paginating raw rows.
 *
 * Query params:
 *   ?days=N           — look back N days (default: 30)
 *   ?objectType=Lead  — filter to one SF object (optional)
 */

import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { AGENT_REF, jsonError, confidenceToNumber } from '@/lib/revops/mappers';
import { revopsQuery, RemoteSqlError } from '@/lib/revops/sql-client';
import { withRevops } from '@/lib/revops/with-revops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// write_outcome categorization — mirrors lib/revops/mappers#extractionCounts:
//   written  → write_outcome = 'written'
//   errored  → write_outcome IN ('invalid','sf_rejected','write_silently_dropped','write_failed')
//   skipped  → everything else (dry_run / skipped_* / null)
const ERRORED_OUTCOMES = ['invalid', 'sf_rejected', 'write_silently_dropped', 'write_failed'];

type CountRow = {
  field_api_name: string;
  sf_object: string;
  group_key: string | null;
  written: string | number;
  skipped: string | number;
  errored: string | number;
  total: string | number;
};

type SkipReasonRow = { skip_reason: string | null; count: string | number };

type FieldConfidenceRow = {
  field_api_name: string;
  sf_object: string;
  confidence: string | null;
  count: string | number;
};

type ConfidenceRow = { confidence: string | null; count: string | number };

const toNum = (v: string | number | null | undefined): number =>
  typeof v === 'number' ? v : v == null ? 0 : Number(v) || 0;

export const GET = withRevops(async (request: Request) => {
  const ctx = await getAuthContext();
  if (!ctx.permissions.modules.data_entry.can_view_analytics) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10), 1), 365);
  const objectType = searchParams.get('objectType');

  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Shared WHERE scope: this agent, within the lookback window, optional object.
  // $1 = AGENT_REF, $2 = sinceIso, $3 = objectType (only when present).
  const params: unknown[] = [AGENT_REF, sinceIso];
  let scope = `fe.agent_ref = $1 AND fe.created_at >= $2`;
  if (objectType) {
    params.push(objectType);
    scope += ` AND fe.sf_object = $3`;
  }

  const erroredCase = `fe.write_outcome = ANY($${params.length + 1})`;
  const queryParams = [...params, ERRORED_OUTCOMES];

  // CASE expressions used by both totals and per-field aggregations.
  const writtenExpr = `COUNT(*) FILTER (WHERE fe.write_outcome = 'written')`;
  const erroredExpr = `COUNT(*) FILTER (WHERE ${erroredCase})`;
  const skippedExpr = `COUNT(*) FILTER (WHERE fe.write_outcome IS DISTINCT FROM 'written' AND NOT (${erroredCase}))`;

  try {
    const [perFieldRows, skipReasonRows, fieldConfidenceRows, confidenceRows] = await Promise.all([
      // ── Per-field stats: written / skipped / errored / total ──
      revopsQuery<CountRow>(
        `SELECT
            fe.field_api_name                AS field_api_name,
            fe.sf_object                     AS sf_object,
            MIN(fe.group_key)                AS group_key,
            ${writtenExpr}                   AS written,
            ${skippedExpr}                   AS skipped,
            ${erroredExpr}                   AS errored,
            COUNT(*)                         AS total
           FROM runs.field_extractions fe
          WHERE ${scope}
          GROUP BY fe.field_api_name, fe.sf_object`,
        queryParams,
      ),
      // ── Skip-reason distribution (non-written rows with a skip_reason) ──
      revopsQuery<SkipReasonRow>(
        `SELECT
            fe.skip_reason AS skip_reason,
            COUNT(*)       AS count
           FROM runs.field_extractions fe
          WHERE ${scope}
            AND fe.write_outcome IS DISTINCT FROM 'written'
            AND fe.skip_reason IS NOT NULL
          GROUP BY fe.skip_reason
          ORDER BY count DESC`,
        params,
      ),
      // ── Per-field × confidence (text buckets) for avg-confidence rollup ──
      revopsQuery<FieldConfidenceRow>(
        `SELECT
            fe.field_api_name AS field_api_name,
            fe.sf_object      AS sf_object,
            fe.confidence     AS confidence,
            COUNT(*)          AS count
           FROM runs.field_extractions fe
          WHERE ${scope}
          GROUP BY fe.field_api_name, fe.sf_object, fe.confidence`,
        params,
      ),
      // ── Confidence distribution across all extractions ──
      revopsQuery<ConfidenceRow>(
        `SELECT
            fe.confidence AS confidence,
            COUNT(*)      AS count
           FROM runs.field_extractions fe
          WHERE ${scope}
          GROUP BY fe.confidence`,
        params,
      ),
    ]);

    // ── Per-field skip-reason map (for perField[].skipReasons) ──
    const skipByField = await revopsQuery<{
      field_api_name: string;
      sf_object: string;
      skip_reason: string | null;
      count: string | number;
    }>(
      `SELECT
          fe.field_api_name AS field_api_name,
          fe.sf_object      AS sf_object,
          fe.skip_reason    AS skip_reason,
          COUNT(*)          AS count
         FROM runs.field_extractions fe
        WHERE ${scope}
          AND fe.write_outcome IS DISTINCT FROM 'written'
          AND fe.skip_reason IS NOT NULL
        GROUP BY fe.field_api_name, fe.sf_object, fe.skip_reason`,
      params,
    );

    // Index per-field skip reasons by field key.
    const skipReasonsByField = new Map<string, Record<string, number>>();
    for (const r of skipByField) {
      const key = `${r.sf_object}|${r.field_api_name}`;
      const bucket = skipReasonsByField.get(key) ?? {};
      if (r.skip_reason) bucket[r.skip_reason] = (bucket[r.skip_reason] ?? 0) + toNum(r.count);
      skipReasonsByField.set(key, bucket);
    }

    // Index per-field confidence sums/counts (confidence stored as text → numeric).
    const confByField = new Map<string, { sum: number; count: number }>();
    for (const r of fieldConfidenceRows) {
      const key = `${r.sf_object}|${r.field_api_name}`;
      const n = confidenceToNumber(r.confidence);
      if (n == null) continue;
      const acc = confByField.get(key) ?? { sum: 0, count: 0 };
      const c = toNum(r.count);
      acc.sum += n * c;
      acc.count += c;
      confByField.set(key, acc);
    }

    // ── Totals ──
    const totals = perFieldRows.reduce(
      (acc, row) => {
        acc.extractions += toNum(row.total);
        acc.written += toNum(row.written);
        acc.skipped += toNum(row.skipped);
        acc.errored += toNum(row.errored);
        return acc;
      },
      { extractions: 0, written: 0, skipped: 0, errored: 0 },
    );

    // ── perField array (same shape the UI consumes) ──
    const perField = perFieldRows
      .map((row) => {
        const key = `${row.sf_object}|${row.field_api_name}`;
        const conf = confByField.get(key) ?? { sum: 0, count: 0 };
        const totalAttempts = toNum(row.total);
        const written = toNum(row.written);
        const skipped = toNum(row.skipped);
        const errored = toNum(row.errored);
        return {
          fieldName: row.field_api_name,
          sfObject: row.sf_object,
          batchId: row.group_key ?? '',
          totalAttempts,
          written,
          skipped,
          errored,
          skipReasons: skipReasonsByField.get(key) ?? {},
          avgConfidence: conf.count > 0 ? conf.sum / conf.count : 0,
          confidenceSum: conf.sum,
          confidenceCount: conf.count,
          skipRate: totalAttempts > 0 ? (skipped + errored) / totalAttempts : 0,
        };
      })
      .sort((a, b) => {
        const aSkipTotal = a.skipped + a.errored;
        const bSkipTotal = b.skipped + b.errored;
        if (aSkipTotal !== bSkipTotal) return bSkipTotal - aSkipTotal;
        return b.totalAttempts - a.totalAttempts;
      });

    // ── skipReasons (global distribution) ──
    const skipReasons = skipReasonRows
      .filter((r) => r.skip_reason)
      .map((r) => ({ reason: r.skip_reason as string, count: toNum(r.count) }))
      .sort((a, b) => b.count - a.count);

    // ── confidenceDistribution: text buckets → high/medium/low/null ──
    const confidenceDistribution = { high: 0, medium: 0, low: 0, null: 0 };
    for (const r of confidenceRows) {
      const n = confidenceToNumber(r.confidence);
      const c = toNum(r.count);
      if (n == null) confidenceDistribution.null += c;
      else if (n >= 0.9) confidenceDistribution.high += c;
      else if (n >= 0.7) confidenceDistribution.medium += c;
      else confidenceDistribution.low += c;
    }

    return NextResponse.json({
      period: { days, since: sinceIso },
      // Server-side aggregation no longer paginates client rows, so there is no
      // pagination ceiling to report. Kept for response-shape compatibility.
      truncated: false,
      hardCap: null,
      totals,
      skipReasons,
      perField,
      confidenceDistribution,
    });
  } catch (err) {
    // Backend-availability errors (missing REVOPS env / unreachable endpoint)
    // bubble to withRevops, which renders a structured 503. Genuine query
    // failures are logged and surfaced as a sanitized 500.
    if (err instanceof RemoteSqlError) throw err;
    console.error('[analytics GET] aggregation error:', err);
    return jsonError('Analytics query failed', 500, 'QUERY_FAILED');
  }
});
