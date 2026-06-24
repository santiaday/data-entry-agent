'use client';

import Link from 'next/link';
import type { RunHealthData } from './types';
import { statusColor, formatDuration, formatAge, num, pct, relativeTime } from './types';
import { MiniSpark } from './MiniSpark';

/**
 * RunHealth — run-level operational view: status mix (stacked bar), a prominent
 * dry-run-vs-live pill (explains why Write % is all would-write), avg/p95
 * duration, throughput sparkline (runs with failures overlaid), failure reasons,
 * and a stuck-runs table that only renders when something is wedged > 6h.
 */
export function RunHealth({ data }: { data: RunHealthData }) {
  const { statusMix, failureReasons, trend, stuck, summary } = data;
  const statusTotal = statusMix.reduce((s, x) => s + x.count, 0);

  const runsSeries = trend.map((t) => t.runs);
  const failedSeries = trend.map((t) => t.failed);
  const dryRunPctLabel = `${(summary.dryRunPct * 100).toFixed(0)}%`;
  const isAllDryRun = summary.dryRunPct >= 0.999;

  return (
    <section className="rounded-xl border bg-card p-6">
      <h2 className="text-sm font-semibold">Run Health</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Are runs completing, failing, or stuck? Durations are large by design (Gong transcript wait
        plus a ~2h settle delay).
      </p>

      {/* ── Dry-run vs live pill + duration StatCards ── */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div
          className={`rounded-xl border p-4 ${
            isAllDryRun ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'
          }`}
        >
          <p className="text-xs font-medium text-muted-foreground">Write mode</p>
          <p className="mt-2 text-lg font-semibold">
            {isAllDryRun ? `${dryRunPctLabel} dry-run` : `${(100 - summary.dryRunPct * 100).toFixed(0)}% live`}
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {isAllDryRun ? 'No writes to Salesforce yet.' : 'Live writes are enabled.'}
          </p>
        </div>
        <DurationCard label="Avg run duration" ms={summary.avgDurationMs} />
        <DurationCard
          label="p95 duration"
          ms={trend.reduce<number | null>((m, t) => (t.p95DurationMs != null && (m == null || t.p95DurationMs > m) ? t.p95DurationMs : m), null)}
        />
      </div>

      {/* ── Status mix stacked bar ── */}
      <div className="mt-6">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Status mix ({num(summary.total)} runs)
        </h3>
        {statusTotal === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No runs in this period.</p>
        ) : (
          <>
            <div className="mt-2 flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
              {statusMix.map((s) => (
                <div
                  key={s.status}
                  className={statusColor(s.status)}
                  style={{ width: `${(s.count / statusTotal) * 100}%` }}
                  title={`${s.status}: ${s.count}`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
              {statusMix.map((s) => (
                <span key={s.status} className="inline-flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-sm ${statusColor(s.status)}`} />
                  <span className="font-mono">{s.status}</span>
                  <span className="tabular-nums">{num(s.count)}</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Throughput + failure reasons ── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-background p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Throughput / day
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {num(summary.completed)} completed · {num(summary.failed)} failed
            </span>
          </div>
          <div className="mt-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-muted-foreground">Runs</span>
              <MiniSpark values={runsSeries} width={220} height={32} colorClass="text-blue-500" title="runs per day" />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-[11px] text-muted-foreground">Failed</span>
              <MiniSpark values={failedSeries} width={220} height={28} colorClass="text-red-500" title="failed runs per day" />
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-background p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Failure reasons
          </h3>
          {failureReasons.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No failed runs in this period.</p>
          ) : (
            <table className="mt-2 w-full text-sm">
              <tbody>
                {failureReasons.map((f) => (
                  <tr key={f.reason} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-mono text-xs">{f.reason}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                      {num(f.count)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── Stuck runs (only when non-empty) ── */}
      {stuck.length > 0 && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50/60 p-4">
          <h3 className="text-xs font-semibold text-red-800">
            {num(stuck.length)} run{stuck.length === 1 ? '' : 's'} stuck &gt; 6h
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-red-200 text-left text-xs text-red-700">
                  <th className="py-1.5 pr-3 font-normal">Run</th>
                  <th className="py-1.5 pr-3 font-normal">Subject</th>
                  <th className="py-1.5 pr-3 font-normal">Status</th>
                  <th className="py-1.5 pr-3 font-normal">Started</th>
                  <th className="py-1.5 pr-3 text-right font-normal">Age</th>
                </tr>
              </thead>
              <tbody>
                {stuck.map((r) => (
                  <tr key={r.runId} className="border-b border-red-100 last:border-0">
                    <td className="py-1.5 pr-3 text-xs">
                      <Link
                        href={`/data-entry/runs/${encodeURIComponent(r.runId)}`}
                        className="font-mono text-emerald-700 underline-offset-2 hover:underline"
                      >
                        {r.runId}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[11px]">
                      {r.subjectKind ?? '—'} {r.subjectId ?? ''}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">{r.status}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground" title={r.startedAt}>
                      {relativeTime(r.startedAt)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-red-700">
                      {formatAge(r.ageSeconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-[11px] text-muted-foreground">
        Run failure rate {pct(summary.failureRate)} · avg duration {formatDuration(summary.avgDurationMs)}
      </p>
    </section>
  );
}

function DurationCard({ label, ms }: { label: string; ms: number | null }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums">{formatDuration(ms)}</p>
    </div>
  );
}
