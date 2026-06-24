'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Analytics } from './analytics/types';
import { HeaderKpis } from './analytics/HeaderKpis';
import { FieldHealthTable, type FieldChip } from './analytics/FieldHealthTable';
import { ErrorAnalytics } from './analytics/ErrorAnalytics';
import { RunHealth } from './analytics/RunHealth';

type ObjectType = 'all' | 'Lead' | 'Opportunity';

/**
 * AnalyticsView — orchestrates the data-entry analytics page. Owns the page-level
 * filters (time range, object) that drive the API call, plus the client-side
 * Field-Health chips, and composes the four sub-sections. Heavy lifting (SQL,
 * rates, attention, gap-filled trends) is done server-side in the route.
 */
export default function AnalyticsView() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Page-level filters (drive the query).
  const [days, setDays] = useState(30);
  const [objectType, setObjectType] = useState<ObjectType>('all');

  // Client-side Field-Health chips.
  const [chips, setChips] = useState<Set<FieldChip>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ days: String(days) });
    if (objectType !== 'all') params.set('objectType', objectType);
    fetch(`/api/data-entry/analytics?${params}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data || !data.kpis) {
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

  useEffect(() => {
    load();
  }, [load]);

  const toggleChip = useCallback((c: FieldChip) => {
    setChips((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }, []);

  const focusNeedsAttention = useCallback(() => {
    setChips((prev) => {
      const next = new Set(prev);
      next.add('needs_attention');
      return next;
    });
    document.getElementById('field-health')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  if (loading && !analytics) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl border bg-card" />
        <div className="h-64 animate-pulse rounded-xl border bg-card" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6">
        <p className="text-sm font-medium text-destructive">Couldn&apos;t load analytics</p>
        <p className="mt-1 break-words text-xs text-muted-foreground">{error ?? 'No data returned.'}</p>
        <button
          onClick={load}
          type="button"
          className="mt-3 rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
        >
          Retry
        </button>
      </div>
    );
  }

  const sinceLabel = new Date(analytics.period.since).toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Field health, errors, and run health for the data-entry agent. Populate, write, and
            error are tracked as separate axes — <code>dry_run</code> means &ldquo;would write&rdquo;, not
            &ldquo;skipped&rdquo;.
          </p>
        </div>
        {loading && <span className="text-xs text-muted-foreground">Refreshing…</span>}
      </div>

      {/* ── Page filters ── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Time range</label>
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
          <label className="mb-1 block text-xs text-muted-foreground">Object</label>
          <select
            value={objectType}
            onChange={(e) => setObjectType(e.target.value as ObjectType)}
            className="rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            <option value="all">All</option>
            <option value="Lead">Lead</option>
            <option value="Opportunity">Opportunity</option>
          </select>
        </div>
        <p className="pb-2 text-xs text-muted-foreground">since {sinceLabel}</p>
      </div>

      {/* ── 4. Header KPIs ── */}
      <HeaderKpis
        kpis={analytics.kpis}
        errorTrend={analytics.errors.trend}
        runTrend={analytics.runs.trend}
        onNeedsAttention={focusNeedsAttention}
      />

      {/* ── 1. Field Health (centerpiece) ── */}
      <FieldHealthTable fields={analytics.fieldHealth} chips={chips} onToggleChip={toggleChip} />

      {/* ── 2. Error Analytics ── */}
      <ErrorAnalytics data={analytics.errors} />

      {/* ── 3. Run Health ── */}
      <RunHealth data={analytics.runs} />
    </div>
  );
}
