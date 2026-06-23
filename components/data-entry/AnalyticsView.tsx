'use client';

import { useEffect, useState, useCallback } from 'react';
import { StatCard } from './StatCard';

type SkipReasonCount = { reason: string; count: number };

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
  skipRate: number;
};

type Analytics = {
  period: { days: number; since: string };
  truncated?: boolean;
  hardCap?: number;
  totals: {
    extractions: number;
    written: number;
    skipped: number;
    errored: number;
  };
  skipReasons: SkipReasonCount[];
  perField: FieldStat[];
  confidenceDistribution: { high: number; medium: number; low: number; null: number };
};

const SKIP_REASON_DOCS: Record<string, string> = {
  no_context_found: 'The LLM returned null — no evidence for this field in the record\'s context (no Gong transcripts, emails, or activities mentioning it). This is often legitimate, not a bug.',
  field_not_blank: 'Write mode is fill_blank and the SF field already had a value — left it alone by design.',
  dry_run: 'Dry-run mode — intentionally not written.',
  validation_failed: 'The LLM returned a value but it failed local validation (bad picklist option, wrong date format, out of range). Distinct from "no_context_found" — here the LLM found SOMETHING, just not a valid value.',
  sf_rejected: 'SF REST API rejected the value. Usually a record-type picklist restriction or validation rule on the object.',
  write_silently_dropped: 'SF returned 204 success but the field value didn\'t actually change. Usually a field-level-security restriction on the integration user.',
  write_failed: 'Whole PATCH failed (auth, 500, no recordId). See the run\'s error column.',
  unknown_field: 'LLM returned a field name we don\'t have a config for. Shouldn\'t normally happen.',
  // Legacy (pre-rename), kept for historical data still in DB
  no_value_extracted: '[Legacy] Same meaning as no_context_found — the LLM found nothing. Rows labelled this way are from before the rename.',
};

const SKIP_REASON_ACTIONS: Record<string, string> = {
  no_context_found: 'Usually expected — not every record has data for every field. If a specific field is ALWAYS missing, consider: (a) rewording the extraction instruction at /data-entry/fields, (b) disabling the field entirely if your sources never cover it.',
  field_not_blank: 'If you want to refresh these values, change the field\'s write mode to "overwrite" in /data-entry/fields.',
  dry_run: 'No action needed — switch off --dry-run to actually write.',
  validation_failed: 'Check /data-entry/fields for this field\'s picklist options + validation rules. Does the SF picklist match what you\'ve seeded? The LLM may be suggesting values that aren\'t in the allowed set.',
  sf_rejected: 'Go to SF Setup → Object Manager → Record Types → [type used] → Picklists Available for Editing. Ensure the value is in Selected Values.',
  write_silently_dropped: 'Grant the integration user Edit FLS on the field. SF Setup → Permission Sets or Profiles → Field-Level Security.',
  write_failed: 'Check the run\'s error column for the specific SF error.',
  no_value_extracted: 'Historical label — same action as no_context_found.',
};

export default function AnalyticsView() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [objectType, setObjectType] = useState<'all' | 'Lead' | 'Opportunity'>('all');
  const [skipReasonFilter, setSkipReasonFilter] = useState<string>('all');

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(days) });
    if (objectType !== 'all') params.set('objectType', objectType);
    fetch(`/api/data-entry/analytics?${params}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data || !data.totals) {
          throw new Error(data?.error ?? `Failed to load analytics (${r.status})`);
        }
        return data as Analytics;
      })
      .then((data) => setAnalytics(data))
      .catch((e) => {
        setAnalytics(null);
        setError(e instanceof Error ? e.message : 'Failed to load analytics');
      })
      .finally(() => setLoading(false));
  }, [days, objectType]);

  useEffect(() => { load(); }, [load]);

  if (loading && !analytics) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border bg-card" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <p className="text-sm font-medium text-destructive">Couldn&apos;t load analytics</p>
        <p className="mt-1 text-xs text-muted-foreground break-words">{error ?? 'No data returned.'}</p>
        <button
          onClick={load}
          type="button"
          className="mt-3 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
        >
          Retry
        </button>
      </div>
    );
  }

  const filteredFields = skipReasonFilter === 'all'
    ? analytics.perField
    : analytics.perField.filter((f) => (f.skipReasons[skipReasonFilter] ?? 0) > 0);

  const skipRate = analytics.totals.extractions > 0
    ? ((analytics.totals.skipped + analytics.totals.errored) / analytics.totals.extractions) * 100
    : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Extraction Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Which fields get skipped the most and why. Hover a skip reason to see what it means and how to fix it.
        </p>
      </div>

      {/* ── Filters ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Period</label>
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            <option value={1}>Last 1 day</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Object</label>
          <select
            value={objectType}
            onChange={(e) => setObjectType(e.target.value as 'all' | 'Lead' | 'Opportunity')}
            className="rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            <option value="all">All</option>
            <option value="Lead">Lead</option>
            <option value="Opportunity">Opportunity</option>
          </select>
        </div>
      </div>

      {/* ── Truncation warning ─────────────────────────── */}
      {analytics.truncated && (
        <div className="rounded-xl border border-orange-300 bg-orange-50/60 p-4 text-sm text-orange-900">
          <strong>Results truncated.</strong> This period has more than {analytics.hardCap?.toLocaleString()} extractions.
          The numbers below reflect only the most recent {analytics.hardCap?.toLocaleString()} rows in the window. Narrow
          the period or filter by object to see full stats — or we can add a Postgres aggregation RPC for no-cap queries.
        </div>
      )}

      {/* ── Headline totals ───────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total Extractions" value={analytics.totals.extractions.toLocaleString()} />
        <StatCard label="Written" value={analytics.totals.written.toLocaleString()} />
        <StatCard label="Skipped" value={analytics.totals.skipped.toLocaleString()} />
        <StatCard label="Skip Rate" value={`${skipRate.toFixed(1)}%`} />
      </div>

      {/* ── Skip reasons breakdown ────────────────────── */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Skip Reasons</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Click a reason to filter the per-field table below. Hover the info for remediation steps.
        </p>

        {analytics.skipReasons.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No skipped extractions in this period.</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-normal">Reason</th>
                <th className="py-2 pr-3 font-normal">Count</th>
                <th className="py-2 pr-3 font-normal">% of skipped</th>
                <th className="py-2 font-normal">Meaning / Fix</th>
              </tr>
            </thead>
            <tbody>
              {analytics.skipReasons.map((r) => {
                const totalSkipped = analytics.skipReasons.reduce((s, x) => s + x.count, 0);
                const pct = totalSkipped > 0 ? (r.count / totalSkipped) * 100 : 0;
                const isFiltered = skipReasonFilter === r.reason;
                return (
                  <tr
                    key={r.reason}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isFiltered}
                    className={`border-b last:border-0 cursor-pointer hover:bg-accent/50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-200 ${isFiltered ? 'bg-blue-50' : ''}`}
                    onClick={() => setSkipReasonFilter(isFiltered ? 'all' : r.reason)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSkipReasonFilter(isFiltered ? 'all' : r.reason);
                      }
                    }}
                  >
                    <td className="py-2 pr-3 font-mono text-xs">
                      {r.reason}
                      {isFiltered && <span className="ml-2 text-xs text-blue-700">(filtered)</span>}
                    </td>
                    <td className="py-2 pr-3 font-mono">{r.count.toLocaleString()}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 rounded-full bg-gray-200">
                          <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground">{pct.toFixed(1)}%</span>
                      </div>
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">
                      <div>{SKIP_REASON_DOCS[r.reason] ?? 'No documentation for this reason.'}</div>
                      {SKIP_REASON_ACTIONS[r.reason] && (
                        <div className="mt-1 text-foreground">
                          <strong>Fix:</strong> {SKIP_REASON_ACTIONS[r.reason]}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Per-field table ──────────────────────────── */}
      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold">Per-Field Stats</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Sorted by most skipped/errored first. Fields at the top are your biggest opportunity for improvement.
            </p>
          </div>
          {skipReasonFilter !== 'all' && (
            <button
              onClick={() => setSkipReasonFilter('all')}
              type="button"
              className="text-xs text-blue-600 hover:underline rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
            >
              Clear filter
            </button>
          )}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-normal">Field</th>
                <th className="py-2 pr-3 font-normal">Object</th>
                <th className="py-2 pr-3 font-normal">Batch</th>
                <th className="py-2 pr-3 font-normal">Attempts</th>
                <th className="py-2 pr-3 font-normal">Written</th>
                <th className="py-2 pr-3 font-normal">Skipped</th>
                <th className="py-2 pr-3 font-normal">Errored</th>
                <th className="py-2 pr-3 font-normal">Skip Rate</th>
                <th className="py-2 font-normal">Top Skip Reason</th>
              </tr>
            </thead>
            <tbody>
              {filteredFields.map((f) => {
                const topSkipReason = Object.entries(f.skipReasons).sort((a, b) => b[1] - a[1])[0];
                const rateColor = f.skipRate > 0.8 ? 'text-destructive'
                  : f.skipRate > 0.5 ? 'text-orange-600'
                  : 'text-muted-foreground';
                return (
                  <tr key={`${f.sfObject}-${f.fieldName}`} className="border-b last:border-0 hover:bg-accent/50 transition">
                    <td className="py-2 pr-3 font-mono text-xs">{f.fieldName}</td>
                    <td className="py-2 pr-3 text-xs">{f.sfObject}</td>
                    <td className="py-2 pr-3 text-xs text-muted-foreground">{f.batchId}</td>
                    <td className="py-2 pr-3 font-mono">{f.totalAttempts}</td>
                    <td className="py-2 pr-3 font-mono text-emerald-700">{f.written}</td>
                    <td className="py-2 pr-3 font-mono text-yellow-700">{f.skipped}</td>
                    <td className="py-2 pr-3 font-mono text-destructive">{f.errored}</td>
                    <td className={`py-2 pr-3 font-mono ${rateColor}`}>
                      {(f.skipRate * 100).toFixed(0)}%
                    </td>
                    <td className="py-2 text-xs">
                      {topSkipReason ? (
                        <span className="font-mono text-muted-foreground">
                          {topSkipReason[0]} ({topSkipReason[1]})
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {filteredFields.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">No fields match the current filter.</p>
        )}
      </section>

      {/* ── Confidence distribution ──────────────────── */}
      <section className="rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Confidence Distribution</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          What confidence levels the LLM is returning across all extractions.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="High (≥90%)" value={analytics.confidenceDistribution.high.toLocaleString()} />
          <StatCard label="Medium (≥70%)" value={analytics.confidenceDistribution.medium.toLocaleString()} />
          <StatCard label="Low (<70%)" value={analytics.confidenceDistribution.low.toLocaleString()} />
          <StatCard label="Unknown" value={analytics.confidenceDistribution.null.toLocaleString()} />
        </div>
      </section>
    </div>
  );
}
