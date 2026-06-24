/**
 * GET /api/data-entry/analytics
 *
 * Operational analytics for the data-entry agent, built around three ORTHOGONAL
 * axes (the prior version conflated them, mislabelling the dominant `dry_run`
 * disposition as "skipped" → a useless ~100% skip rate):
 *
 *   • POPULATED        — extracted_value IS NOT NULL (did the LLM find a value?)
 *   • WRITE DISPOSITION — written / would_write (dry_run) / blocked / no_value / low_confidence
 *   • ERROR            — sf_rejected / write_silently_dropped / write_failed / invalid
 *                        OR a non-empty validation_errors[]. dry_run and FLS are
 *                        NOT errors-in-that-sense (FLS is a CONFIG problem).
 *
 * Sections (one Promise.all of independent aggregations, scoped to this agent):
 *   1. Field Health   — per (sf_object, field) populate/write/error rates + attention flag
 *   2. Error Analytics — families (config/data/system/quality), leaderboard, validation msgs, daily trend
 *   3. Run Health      — status mix, failure reasons, throughput/duration/dry-vs-live, stuck > 6h
 *   4. Header KPIs     — extractions, populate %, would-write/written %, error %, attention count, run-fail %
 *
 * All rate/attention derivations and trend gap-filling happen in TS (immutable
 * maps) so the SQL stays pure aggregation. No schema changes.
 *
 * Query params:
 *   ?days=N            — look back N days (default 30; clamped 1..365)
 *   ?objectType=Lead   — filter to one SF object (also filters runs by subject_kind)
 */

import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { AGENT_REF, jsonError } from '@/lib/revops/mappers';
import { revopsQuery, RemoteSqlError } from '@/lib/revops/sql-client';
import { withRevops } from '@/lib/revops/with-revops';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ── Outcome / reason taxonomy (single source of truth for the SQL fragments) ──
const ERROR_OUTCOMES = ['sf_rejected', 'write_silently_dropped', 'write_failed', 'invalid'];

const toNum = (v: unknown): number =>
  typeof v === 'number' ? v : v == null ? 0 : Number(v) || 0;

const toStr = (v: unknown): string | null =>
  v == null ? null : String(v);

const rate = (num: number, den: number): number => (den > 0 ? num / den : 0);

const round = (n: number, dp = 4): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** A row in field_extractions is an error if the write outcome is a hard
 *  failure OR it carries validation messages. dry_run / FLS are excluded here
 *  (FLS is surfaced separately as a config family). */
const IS_ERROR_SQL = `(
  fe.write_outcome IN ('sf_rejected','write_silently_dropped','write_failed','invalid')
  OR (fe.validation_errors IS NOT NULL AND cardinality(fe.validation_errors) > 0)
)`;

/** Broader "error-or-blocked" predicate used by the leaderboard + error trend,
 *  which also surface FLS (config-blocked) and validation_failed rows. */
const IS_ERROR_OR_BLOCKED_SQL = `(
  fe.write_outcome IN ('sf_rejected','write_silently_dropped','write_failed','invalid')
  OR fe.skip_reason IN ('fls_not_writable','validation_failed')
  OR (fe.validation_errors IS NOT NULL AND cardinality(fe.validation_errors) > 0)
)`;

// ── Row types returned by each aggregation ──
type FieldRollupRow = {
  sf_object: string;
  field_api_name: string;
  attempts: string | number;
  populated: string | number;
  written: string | number;
  would_write: string | number;
  errored: string | number;
  low_conf_skips: string | number;
  avg_conf: string | number | null;
  last_seen_at: string | null;
};
type LastValueRow = {
  sf_object: string;
  field_api_name: string;
  last_value: string | null;
  last_value_at: string | null;
};
type DominantSkipRow = {
  sf_object: string;
  field_api_name: string;
  skip_reason: string | null;
  cnt: string | number;
};
type ConfigFieldRow = {
  sf_object: string;
  field_api_name: string;
  value_type: string | null;
  write_mode: string | null;
  group_key: string | null;
  is_active: boolean;
};
type OutcomeRow = { write_outcome: string | null; count: string | number; pct: string | number | null };
type SkipReasonRow = { skip_reason: string | null; count: string | number; pct: string | number | null };
type LeaderboardRow = {
  sf_object: string;
  field_api_name: string;
  errors: string | number;
  sf_rejected: string | number;
  fls: string | number;
  write_failed: string | number;
  invalid: string | number;
};
type ValidationMsgRow = { message: string | null; count: string | number };
type ErrorTrendRow = { day: string; errors: string | number; attempts: string | number };
type StatusRow = { status: string | null; count: string | number };
type FailureRow = { reason: string | null; count: string | number };
type RunTrendRow = {
  day: string;
  runs: string | number;
  completed: string | number;
  failed: string | number;
  dry_run: string | number;
  live: string | number;
  avg_duration_ms: string | number | null;
  p95_duration_ms: string | number | null;
};
type StuckRow = {
  run_id: string;
  subject_id: string | null;
  subject_kind: string | null;
  status: string | null;
  started_at: string;
  age_seconds: string | number;
};
type ExtractionKpiRow = {
  attempts: string | number;
  distinct_fields: string | number;
  populated: string | number;
  written: string | number;
  would_write: string | number;
  errored: string | number;
};

// ── Error-family classification (config vs data vs system vs quality) ──
type ErrorKind = 'config' | 'data' | 'system' | 'quality';
const ERROR_FAMILY_META: Array<{ family: string; label: string; kind: ErrorKind }> = [
  { family: 'fls', label: 'FLS / config-blocked', kind: 'config' },
  { family: 'sf_rejected', label: 'SF rejected (data)', kind: 'data' },
  { family: 'invalid', label: 'Invalid / validation', kind: 'data' },
  { family: 'write_failed', label: 'Write failed (system)', kind: 'system' },
  { family: 'low_confidence', label: 'Low confidence', kind: 'quality' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Build an ordered list of YYYY-MM-DD day keys from `sinceIso` through today (UTC). */
function dayKeys(sinceIso: string): string[] {
  const start = new Date(sinceIso);
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const now = new Date();
  const endDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const keys: string[] = [];
  for (let t = startDay; t <= endDay; t += DAY_MS) {
    keys.push(new Date(t).toISOString().slice(0, 10));
  }
  return keys;
}

/** Normalize a day cell (DB may hand back a date or a full timestamp). */
const dayKey = (v: unknown): string => String(v).slice(0, 10);

export const GET = withRevops(async (request: Request) => {
  const ctx = await getAuthContext();
  if (!ctx.permissions.modules.data_entry.can_view_analytics) {
    return jsonError('Forbidden', 403, 'FORBIDDEN');
  }

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '30', 10) || 30, 1), 365);
  const objectType = searchParams.get('objectType');

  const sinceIso = new Date(Date.now() - days * DAY_MS).toISOString();

  // $1 = AGENT_REF, $2 = sinceIso, $3 = objectType (only present when filtering).
  // We keep two scope strings because field_extractions filters on sf_object
  // while agent_runs filters on subject_kind, but they share the same $3.
  const feParams: unknown[] = [AGENT_REF, sinceIso];
  let feScope = `fe.agent_ref = $1 AND fe.created_at >= $2`;
  let arScope = `ar.agent_ref = $1 AND ar.started_at >= $2`;
  if (objectType) {
    feParams.push(objectType);
    feScope += ` AND fe.sf_object = $3`;
    // subject_kind is stored lower-cased ('lead'/'opportunity'); objectType is
    // 'Lead'/'Opportunity' → compare case-insensitively so the object filter works.
    arScope += ` AND lower(ar.subject_kind) = lower($3)`;
  }

  // config.field_definitions has no time window, so its params drop $2:
  // $1 = AGENT_REF (+ $2 = objectType when filtering).
  const cfgParams: unknown[] = objectType ? [AGENT_REF, objectType] : [AGENT_REF];
  const cfgScopeNorm = objectType
    ? `agent_ref = $1 AND is_active = true AND sf_object = $2`
    : `agent_ref = $1 AND is_active = true`;

  try {
    const [
      fieldRollup,
      lastValues,
      dominantSkips,
      configFields,
      outcomeDist,
      skipReasonDist,
      leaderboard,
      validationMsgs,
      errorTrend,
      statusMix,
      failureReasons,
      runTrend,
      stuckRuns,
      extractionKpi,
    ] = await Promise.all([
      // ── 1a. Field rollup ──
      revopsQuery<FieldRollupRow>(
        `SELECT
            fe.sf_object,
            fe.field_api_name,
            COUNT(*)                                               AS attempts,
            COUNT(*) FILTER (WHERE fe.extracted_value IS NOT NULL) AS populated,
            COUNT(*) FILTER (WHERE fe.write_outcome = 'written')   AS written,
            COUNT(*) FILTER (WHERE fe.write_outcome = 'dry_run')   AS would_write,
            COUNT(*) FILTER (WHERE ${IS_ERROR_SQL})                AS errored,
            COUNT(*) FILTER (WHERE fe.write_outcome = 'skipped_low_confidence') AS low_conf_skips,
            AVG(CASE fe.confidence WHEN 'high' THEN 0.95 WHEN 'medium' THEN 0.75
                                   WHEN 'low' THEN 0.4 END)        AS avg_conf,
            MAX(fe.created_at)                                     AS last_seen_at
           FROM runs.field_extractions fe
          WHERE ${feScope}
          GROUP BY fe.sf_object, fe.field_api_name
          ORDER BY fe.sf_object, fe.field_api_name`,
        feParams,
      ),
      // ── 1b. Last-seen non-null value per field ──
      revopsQuery<LastValueRow>(
        `SELECT DISTINCT ON (fe.sf_object, fe.field_api_name)
            fe.sf_object,
            fe.field_api_name,
            fe.extracted_value AS last_value,
            fe.created_at      AS last_value_at
           FROM runs.field_extractions fe
          WHERE ${feScope}
            AND fe.extracted_value IS NOT NULL
          ORDER BY fe.sf_object, fe.field_api_name, fe.created_at DESC`,
        feParams,
      ),
      // ── 1c. Dominant skip_reason per field (mode via ROW_NUMBER) ──
      revopsQuery<DominantSkipRow>(
        `SELECT sf_object, field_api_name, skip_reason, cnt FROM (
            SELECT fe.sf_object, fe.field_api_name, fe.skip_reason,
                   COUNT(*) AS cnt,
                   ROW_NUMBER() OVER (PARTITION BY fe.sf_object, fe.field_api_name
                                      ORDER BY COUNT(*) DESC) AS rn
              FROM runs.field_extractions fe
             WHERE ${feScope}
               AND fe.skip_reason IS NOT NULL
             GROUP BY fe.sf_object, fe.field_api_name, fe.skip_reason
          ) t WHERE rn = 1`,
        feParams,
      ),
      // ── 1d. Configured fields (LEFT JOIN target → "never_extracted" surfaces) ──
      revopsQuery<ConfigFieldRow>(
        `SELECT sf_object, field_api_name, value_type, write_mode, group_key, is_active
           FROM config.field_definitions
          WHERE ${cfgScopeNorm}`,
        cfgParams,
      ),
      // ── 2a. Outcome distribution (counts + pct) ──
      revopsQuery<OutcomeRow>(
        `SELECT fe.write_outcome,
                COUNT(*) AS count,
                ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS pct
           FROM runs.field_extractions fe
          WHERE ${feScope}
          GROUP BY fe.write_outcome
          ORDER BY count DESC`,
        feParams,
      ),
      // ── 2b. Skip-reason distribution (counts + pct) ──
      revopsQuery<SkipReasonRow>(
        `SELECT fe.skip_reason,
                COUNT(*) AS count,
                ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 1) AS pct
           FROM runs.field_extractions fe
          WHERE ${feScope}
            AND fe.skip_reason IS NOT NULL
          GROUP BY fe.skip_reason
          ORDER BY count DESC`,
        feParams,
      ),
      // ── 2c. Per-field error leaderboard (top 20) ──
      revopsQuery<LeaderboardRow>(
        `SELECT fe.sf_object, fe.field_api_name,
                COUNT(*)                                                        AS errors,
                COUNT(*) FILTER (WHERE fe.write_outcome = 'sf_rejected')        AS sf_rejected,
                COUNT(*) FILTER (WHERE fe.write_outcome = 'write_silently_dropped'
                                   OR fe.skip_reason = 'fls_not_writable')      AS fls,
                COUNT(*) FILTER (WHERE fe.write_outcome = 'write_failed')       AS write_failed,
                COUNT(*) FILTER (WHERE fe.write_outcome = 'invalid'
                                   OR fe.skip_reason = 'validation_failed'
                                   OR (fe.validation_errors IS NOT NULL
                                       AND cardinality(fe.validation_errors) > 0)) AS invalid
           FROM runs.field_extractions fe
          WHERE ${feScope}
            AND ${IS_ERROR_OR_BLOCKED_SQL}
          GROUP BY fe.sf_object, fe.field_api_name
          ORDER BY errors DESC
          LIMIT 20`,
        feParams,
      ),
      // ── 2d. validation_errors message frequency (unnest text[]) ──
      revopsQuery<ValidationMsgRow>(
        `SELECT ve AS message, COUNT(*) AS count
           FROM runs.field_extractions fe, unnest(fe.validation_errors) AS ve
          WHERE ${feScope}
          GROUP BY ve
          ORDER BY count DESC
          LIMIT 20`,
        feParams,
      ),
      // ── 2e. Errors per day (trend) ──
      revopsQuery<ErrorTrendRow>(
        `SELECT date_trunc('day', fe.created_at)::date AS day,
                COUNT(*) FILTER (WHERE ${IS_ERROR_OR_BLOCKED_SQL}) AS errors,
                COUNT(*)                                           AS attempts
           FROM runs.field_extractions fe
          WHERE ${feScope}
          GROUP BY day
          ORDER BY day`,
        feParams,
      ),
      // ── 3a. Run status mix ──
      revopsQuery<StatusRow>(
        `SELECT ar.status, COUNT(*) AS count
           FROM runs.agent_runs ar
          WHERE ${arScope}
          GROUP BY ar.status
          ORDER BY count DESC`,
        feParams,
      ),
      // ── 3b. Failure reasons (failed runs) ──
      revopsQuery<FailureRow>(
        `SELECT COALESCE(ar.ended_reason, ar.error->>'message', 'unknown') AS reason,
                COUNT(*) AS count
           FROM runs.agent_runs ar
          WHERE ${arScope}
            AND ar.status = 'failed'
          GROUP BY reason
          ORDER BY count DESC
          LIMIT 15`,
        feParams,
      ),
      // ── 3c. Throughput + duration + dry/live per day ──
      revopsQuery<RunTrendRow>(
        `SELECT date_trunc('day', ar.started_at)::date AS day,
                COUNT(*)                                              AS runs,
                COUNT(*) FILTER (WHERE ar.status = 'completed')       AS completed,
                COUNT(*) FILTER (WHERE ar.status = 'failed')          AS failed,
                COUNT(*) FILTER (WHERE (ar.trigger_payload->>'dry_run')::boolean IS TRUE)     AS dry_run,
                COUNT(*) FILTER (WHERE (ar.trigger_payload->>'dry_run')::boolean IS NOT TRUE) AS live,
                ROUND(AVG(ar.duration_ms) FILTER (WHERE ar.duration_ms IS NOT NULL)) AS avg_duration_ms,
                percentile_disc(0.95) WITHIN GROUP (ORDER BY ar.duration_ms)
                  FILTER (WHERE ar.duration_ms IS NOT NULL)           AS p95_duration_ms
           FROM runs.agent_runs ar
          WHERE ${arScope}
          GROUP BY day
          ORDER BY day`,
        feParams,
      ),
      // ── 3d. Stuck / in-flight runs older than 6h (NOT object-scoped: surfaces all wedged runs) ──
      revopsQuery<StuckRow>(
        `SELECT ar.run_id, ar.subject_id, ar.subject_kind, ar.status, ar.started_at,
                EXTRACT(EPOCH FROM (now() - ar.started_at))::bigint AS age_seconds
           FROM runs.agent_runs ar
          WHERE ar.agent_ref = $1
            AND ar.status::text IN ('pending','running','sleeping','awaiting_reply','awaiting_subagents','awaiting_approval')
            AND ar.started_at < now() - interval '6 hours'
          ORDER BY ar.started_at ASC
          LIMIT 25`,
        [AGENT_REF],
      ),
      // ── 4a. Extraction KPIs ──
      revopsQuery<ExtractionKpiRow>(
        `SELECT
            COUNT(*)                                               AS attempts,
            COUNT(DISTINCT fe.field_api_name)                      AS distinct_fields,
            COUNT(*) FILTER (WHERE fe.extracted_value IS NOT NULL) AS populated,
            COUNT(*) FILTER (WHERE fe.write_outcome = 'written')   AS written,
            COUNT(*) FILTER (WHERE fe.write_outcome = 'dry_run')   AS would_write,
            COUNT(*) FILTER (WHERE ${IS_ERROR_SQL})                AS errored
           FROM runs.field_extractions fe
          WHERE ${feScope}`,
        feParams,
      ),
    ]);

    // ── Index supporting field maps ──
    const keyOf = (obj: string, field: string) => `${obj}|${field}`;

    const lastValueByField = new Map<string, LastValueRow>();
    for (const r of lastValues) lastValueByField.set(keyOf(r.sf_object, r.field_api_name), r);

    const dominantSkipByField = new Map<string, string>();
    for (const r of dominantSkips) {
      if (r.skip_reason) dominantSkipByField.set(keyOf(r.sf_object, r.field_api_name), r.skip_reason);
    }

    const rollupByField = new Map<string, FieldRollupRow>();
    for (const r of fieldRollup) rollupByField.set(keyOf(r.sf_object, r.field_api_name), r);

    // ── 1. FIELD HEALTH — merge config (LEFT JOIN) with rollup; derive rates + attention ──
    const configByField = new Map<string, ConfigFieldRow>();
    for (const c of configFields) configByField.set(keyOf(c.sf_object, c.field_api_name), c);

    // Union of all field keys (configured ∪ observed) so both never-extracted
    // configured fields AND extracted-but-unconfigured fields surface.
    const allFieldKeys = new Set<string>([...configByField.keys(), ...rollupByField.keys()]);

    const fieldHealth = [...allFieldKeys]
      .map((key) => {
        const cfg = configByField.get(key);
        const r = rollupByField.get(key);
        const [sfObject, fieldApiName] = key.split('|');

        const attempts = r ? toNum(r.attempts) : 0;
        const populated = r ? toNum(r.populated) : 0;
        const written = r ? toNum(r.written) : 0;
        const wouldWrite = r ? toNum(r.would_write) : 0;
        const errored = r ? toNum(r.errored) : 0;
        const lowConfSkips = r ? toNum(r.low_conf_skips) : 0;
        const avgConfidence = r && r.avg_conf != null ? round(toNum(r.avg_conf), 3) : 0;

        const populateRate = round(rate(populated, attempts));
        const writeRate = round(rate(written + wouldWrite, attempts));
        const errorRate = round(rate(errored, attempts));

        // Derived attention flag (precedence: never → high_error → low_populate → low_confidence → ok)
        let attention: 'never_extracted' | 'high_error' | 'low_populate' | 'low_confidence' | 'ok';
        if (attempts === 0) attention = 'never_extracted';
        else if (errorRate >= 0.1) attention = 'high_error';
        else if (attempts >= 10 && populateRate < 0.5) attention = 'low_populate';
        else if (attempts >= 10 && avgConfidence > 0 && avgConfidence < 0.6) attention = 'low_confidence';
        else attention = 'ok';

        const lv = lastValueByField.get(key);

        return {
          sfObject,
          fieldApiName,
          valueType: cfg?.value_type ?? null,
          writeMode: cfg?.write_mode ?? null,
          groupKey: cfg?.group_key ?? null,
          configured: Boolean(cfg),
          attempts,
          populated,
          populateRate,
          written,
          wouldWrite,
          writeRate,
          errored,
          errorRate,
          lowConfSkips,
          avgConfidence,
          dominantSkipReason: dominantSkipByField.get(key) ?? null,
          lastValue: lv?.last_value ?? null,
          lastValueAt: lv?.last_value_at ?? null,
          lastSeenAt: r?.last_seen_at ?? null,
          attention,
        };
      })
      // Default sort: attention severity desc, then error rate desc, then attempts desc.
      .sort((a, b) => {
        const sev = { high_error: 4, low_populate: 3, low_confidence: 2, never_extracted: 1, ok: 0 } as const;
        if (sev[a.attention] !== sev[b.attention]) return sev[b.attention] - sev[a.attention];
        if (a.errorRate !== b.errorRate) return b.errorRate - a.errorRate;
        return b.attempts - a.attempts;
      });

    const fieldsNeedingAttention = fieldHealth.filter((f) => f.attention !== 'ok').length;

    // ── 2. ERROR ANALYTICS ──
    const outcomeMap = new Map<string, number>();
    for (const r of outcomeDist) outcomeMap.set(r.write_outcome ?? 'unknown', toNum(r.count));
    const skipMap = new Map<string, number>();
    for (const r of skipReasonDist) skipMap.set(r.skip_reason ?? 'unknown', toNum(r.count));

    // Sum each error family from the outcome / skip distributions (one source of truth).
    const totalErrorish =
      (outcomeMap.get('sf_rejected') ?? 0) +
      (outcomeMap.get('write_silently_dropped') ?? 0) +
      (skipMap.get('fls_not_writable') ?? 0) +
      (outcomeMap.get('write_failed') ?? 0) +
      (outcomeMap.get('invalid') ?? 0) +
      (skipMap.get('validation_failed') ?? 0) +
      (outcomeMap.get('skipped_low_confidence') ?? 0);

    const familyCount: Record<string, number> = {
      fls: (outcomeMap.get('write_silently_dropped') ?? 0) + (skipMap.get('fls_not_writable') ?? 0),
      sf_rejected: outcomeMap.get('sf_rejected') ?? 0,
      invalid: (outcomeMap.get('invalid') ?? 0) + (skipMap.get('validation_failed') ?? 0),
      write_failed: outcomeMap.get('write_failed') ?? 0,
      low_confidence: outcomeMap.get('skipped_low_confidence') ?? 0,
    };

    const byFamily = ERROR_FAMILY_META.map((m) => {
      const count = familyCount[m.family] ?? 0;
      return {
        family: m.family,
        label: m.label,
        kind: m.kind,
        count,
        pct: totalErrorish > 0 ? round((count / totalErrorish) * 100, 1) : 0,
      };
    }).filter((f) => f.count > 0);

    const outcomeDistribution = outcomeDist.map((r) => ({
      outcome: r.write_outcome ?? 'unknown',
      count: toNum(r.count),
      pct: r.pct == null ? 0 : round(toNum(r.pct), 1),
    }));

    const skipReasonDistribution = skipReasonDist.map((r) => ({
      reason: r.skip_reason ?? 'unknown',
      count: toNum(r.count),
      pct: r.pct == null ? 0 : round(toNum(r.pct), 1),
    }));

    const fieldLeaderboard = leaderboard.map((r) => ({
      sfObject: r.sf_object,
      fieldApiName: r.field_api_name,
      errors: toNum(r.errors),
      sfRejected: toNum(r.sf_rejected),
      fls: toNum(r.fls),
      writeFailed: toNum(r.write_failed),
      invalid: toNum(r.invalid),
    }));

    const validationMessages = validationMsgs
      .filter((r) => r.message != null)
      .map((r) => ({ message: r.message as string, count: toNum(r.count) }));

    // Gap-fill the error trend across the full day range.
    const keys = dayKeys(sinceIso);
    const errorTrendMap = new Map<string, ErrorTrendRow>();
    for (const r of errorTrend) errorTrendMap.set(dayKey(r.day), r);
    const errorTrendFilled = keys.map((day) => {
      const r = errorTrendMap.get(day);
      return { day, errors: r ? toNum(r.errors) : 0, attempts: r ? toNum(r.attempts) : 0 };
    });

    // ── 3. RUN HEALTH ──
    const statusMixOut = statusMix.map((r) => ({ status: r.status ?? 'unknown', count: toNum(r.count) }));
    const failureReasonsOut = failureReasons.map((r) => ({ reason: r.reason ?? 'unknown', count: toNum(r.count) }));

    const runTrendMap = new Map<string, RunTrendRow>();
    for (const r of runTrend) runTrendMap.set(dayKey(r.day), r);
    const runTrendFilled = keys.map((day) => {
      const r = runTrendMap.get(day);
      return {
        day,
        runs: r ? toNum(r.runs) : 0,
        completed: r ? toNum(r.completed) : 0,
        failed: r ? toNum(r.failed) : 0,
        dryRun: r ? toNum(r.dry_run) : 0,
        live: r ? toNum(r.live) : 0,
        avgDurationMs: r && r.avg_duration_ms != null ? toNum(r.avg_duration_ms) : null,
        p95DurationMs: r && r.p95_duration_ms != null ? toNum(r.p95_duration_ms) : null,
      };
    });

    const stuck = stuckRuns.map((r) => ({
      runId: r.run_id,
      subjectId: r.subject_id,
      subjectKind: r.subject_kind,
      status: r.status ?? 'unknown',
      startedAt: r.started_at,
      ageSeconds: toNum(r.age_seconds),
    }));

    const runTotal = statusMixOut.reduce((s, x) => s + x.count, 0);
    const runCompleted = statusMixOut.find((x) => x.status === 'completed')?.count ?? 0;
    const runFailed = statusMixOut.find((x) => x.status === 'failed')?.count ?? 0;

    // Weighted average duration + dry-run share across the windowed trend.
    let durSum = 0;
    let durRuns = 0;
    let totalDry = 0;
    let totalLive = 0;
    for (const t of runTrendFilled) {
      if (t.avgDurationMs != null && t.runs > 0) {
        durSum += t.avgDurationMs * t.runs;
        durRuns += t.runs;
      }
      totalDry += t.dryRun;
      totalLive += t.live;
    }
    const runSummary = {
      total: runTotal,
      completed: runCompleted,
      failed: runFailed,
      failureRate: round(rate(runFailed, runTotal)),
      avgDurationMs: durRuns > 0 ? Math.round(durSum / durRuns) : null,
      dryRunPct: round(rate(totalDry, totalDry + totalLive)),
      stuckCount: stuck.length,
    };

    // ── 4. HEADER KPIs ──
    const k = extractionKpi[0] ?? {
      attempts: 0,
      distinct_fields: 0,
      populated: 0,
      written: 0,
      would_write: 0,
      errored: 0,
    };
    const attempts = toNum(k.attempts);
    const populated = toNum(k.populated);
    const written = toNum(k.written);
    const wouldWrite = toNum(k.would_write);
    const errored = toNum(k.errored);

    const kpis = {
      attempts,
      distinctFields: toNum(k.distinct_fields),
      populated,
      populateRate: round(rate(populated, attempts)),
      written,
      wouldWrite,
      writeRate: round(rate(written + wouldWrite, attempts)),
      errored,
      errorRate: round(rate(errored, attempts)),
      fieldsNeedingAttention,
      runFailureRate: runSummary.failureRate,
      stuckRuns: runSummary.stuckCount,
    };

    return NextResponse.json({
      period: { days, since: sinceIso, objectType: objectType ?? 'all' },
      kpis,
      fieldHealth,
      errors: {
        byFamily,
        outcomeDistribution,
        skipReasonDistribution,
        fieldLeaderboard,
        validationMessages,
        trend: errorTrendFilled,
      },
      runs: {
        statusMix: statusMixOut,
        failureReasons: failureReasonsOut,
        trend: runTrendFilled,
        stuck,
        summary: runSummary,
      },
    });
  } catch (err) {
    // Backend-availability errors bubble to withRevops (structured 503).
    // Genuine query failures are logged and surfaced as a sanitized 500.
    if (err instanceof RemoteSqlError) throw err;
    console.error('[analytics GET] aggregation error:', err);
    return jsonError('Analytics query failed', 500, 'QUERY_FAILED');
  }
});
