'use client';

import { MiniSpark } from './MiniSpark';
import type { Kpis, ErrorTrendPoint, RunTrendPoint } from './types';
import { num, pct } from './types';

/**
 * HeaderKpis — the six at-a-glance cards. Each metric with a daily series gets a
 * tiny sparkline beneath the number. "Fields needing attention" is clickable and
 * scrolls to the Field Health table (filtered by the parent).
 */
export function HeaderKpis({
  kpis,
  errorTrend,
  runTrend,
  onNeedsAttention,
}: {
  kpis: Kpis;
  errorTrend: ErrorTrendPoint[];
  runTrend: RunTrendPoint[];
  onNeedsAttention: () => void;
}) {
  // Derive per-day series for the sparklines.
  const populateSeries = errorTrend.map((t) => (t.attempts > 0 ? (t.attempts - t.errors) / t.attempts : 0));
  const errorRateSeries = errorTrend.map((t) => (t.attempts > 0 ? t.errors / t.attempts : 0));
  const runsSeries = runTrend.map((t) => t.runs);

  const errorRed = kpis.errorRate >= 0.05;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <KpiCard
        label="Extractions"
        value={num(kpis.attempts)}
        sub={`across ${num(kpis.distinctFields)} fields`}
      />

      <KpiCard
        label="Populate rate"
        value={pct(kpis.populateRate)}
        sub={`${num(kpis.populated)} found a value`}
        spark={populateSeries}
        sparkColor="text-emerald-500"
      />

      <KpiCard
        label="Would-write / Written"
        value={pct(kpis.writeRate)}
        sub={
          kpis.written === 0
            ? `${num(kpis.wouldWrite)} (dry-run)`
            : `${num(kpis.written)} written · ${num(kpis.wouldWrite)} dry-run`
        }
      />

      <KpiCard
        label="Error rate"
        value={pct(kpis.errorRate)}
        sub={`${num(kpis.errored)} errored`}
        spark={errorRateSeries}
        sparkColor={errorRed ? 'text-red-500' : 'text-amber-500'}
        valueClass={errorRed ? 'text-red-600' : undefined}
      />

      <button
        type="button"
        onClick={onNeedsAttention}
        className="rounded-xl border bg-card p-4 text-left transition hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
      >
        <p className="text-xs font-medium text-muted-foreground">Fields needing attention</p>
        <p
          className={`mt-2 text-2xl font-semibold tabular-nums ${
            kpis.fieldsNeedingAttention > 0 ? 'text-amber-600' : ''
          }`}
        >
          {num(kpis.fieldsNeedingAttention)}
        </p>
        <p className="mt-1 text-[11px] text-emerald-700 underline-offset-2 hover:underline">
          View in Field Health →
        </p>
      </button>

      <KpiCard
        label="Run failure rate"
        value={pct(kpis.runFailureRate)}
        sub={kpis.stuckRuns > 0 ? `${num(kpis.stuckRuns)} stuck > 6h` : 'no stuck runs'}
        spark={runsSeries}
        sparkColor="text-blue-500"
        valueClass={kpis.runFailureRate >= 0.05 ? 'text-red-600' : undefined}
        subClass={kpis.stuckRuns > 0 ? 'text-red-600' : undefined}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  spark,
  sparkColor = 'text-emerald-500',
  valueClass,
  subClass,
}: {
  label: string;
  value: string;
  sub?: string;
  spark?: number[];
  sparkColor?: string;
  valueClass?: string;
  subClass?: string;
}) {
  // No sparkline → reuse the plain StatCard for visual parity.
  if (!spark || spark.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 transition hover:shadow-sm">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={`mt-2 text-2xl font-semibold tabular-nums ${valueClass ?? ''}`}>{value}</p>
        {sub && <p className={`mt-1 text-[11px] text-muted-foreground ${subClass ?? ''}`}>{sub}</p>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border bg-card p-4 transition hover:shadow-sm">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${valueClass ?? ''}`}>{value}</p>
      <div className="mt-1 flex items-end justify-between gap-2">
        {sub && <p className={`text-[11px] text-muted-foreground ${subClass ?? ''}`}>{sub}</p>}
        <MiniSpark values={spark} width={56} height={20} colorClass={sparkColor} title={`${label} trend`} />
      </div>
    </div>
  );
}
