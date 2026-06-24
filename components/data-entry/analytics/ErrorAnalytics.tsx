'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ErrorAnalytics as ErrorAnalyticsData } from './types';
import { ERROR_KIND_META, ERROR_FAMILY_ACTIONS, num } from './types';
import { MiniSpark } from './MiniSpark';

const LEADERBOARD_SEGMENTS: Array<{ key: 'fls' | 'sfRejected' | 'invalid' | 'writeFailed'; color: string; label: string }> = [
  { key: 'fls', color: 'bg-amber-500', label: 'FLS / config-blocked' },
  { key: 'sfRejected', color: 'bg-red-500', label: 'SF rejected' },
  { key: 'invalid', color: 'bg-rose-400', label: 'Invalid / validation' },
  { key: 'writeFailed', color: 'bg-purple-500', label: 'Write failed' },
];

/**
 * ErrorAnalytics — error families (config/data/system/quality) with counts +
 * rates + remediation, an errors/day sparkline, a per-field error leaderboard
 * (stacked segments, deep-linking to the run search), validation-message
 * frequency (collapsed), and clickable outcome/skip-reason distributions that
 * cross-filter the Field Health table.
 */
export function ErrorAnalytics({ data }: { data: ErrorAnalyticsData }) {
  const [showValidation, setShowValidation] = useState(false);

  const totalErrors = data.byFamily.reduce((s, f) => s + f.count, 0);
  const errorSeries = data.trend.map((t) => t.errors);
  const peakErrors = Math.max(0, ...errorSeries);

  return (
    <section className="rounded-xl border bg-card p-6">
      <h2 className="text-sm font-semibold">Error Analytics</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        What is erroring and how often. FLS is a <strong>config</strong> problem (grant field-level
        security); <code>dry_run</code> is intentional and not counted as an error.
      </p>

      {/* ── Family cards + errors/day sparkline ── */}
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.byFamily.length === 0 ? (
            <p className="text-sm text-muted-foreground">No errors in this period. 🎉</p>
          ) : (
            data.byFamily.map((f) => {
              const kind = ERROR_KIND_META[f.kind];
              return (
                <div key={f.family} className="rounded-lg border bg-background p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{f.label}</span>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${kind.className}`}>
                      {kind.label}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xl font-semibold tabular-nums">{num(f.count)}</p>
                  <p className="text-[11px] text-muted-foreground">{f.pct.toFixed(1)}% of errors</p>
                  {ERROR_FAMILY_ACTIONS[f.family] && (
                    <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                      {ERROR_FAMILY_ACTIONS[f.family]}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex flex-col justify-between rounded-lg border bg-background p-3 lg:w-56">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Errors / day</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{num(totalErrors)}</p>
            <p className="text-[11px] text-muted-foreground">peak {num(peakErrors)} in a day</p>
          </div>
          <MiniSpark
            values={errorSeries}
            width={208}
            height={40}
            className="mt-2"
            colorClass="text-red-500"
            title="errors per day"
          />
        </div>
      </div>

      {/* ── Field error leaderboard ── */}
      {data.fieldLeaderboard.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Top fields by error count
          </h3>
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            {LEADERBOARD_SEGMENTS.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1">
                <span className={`inline-block h-2 w-2 rounded-sm ${s.color}`} /> {s.label}
              </span>
            ))}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-normal">Field</th>
                  <th className="py-2 pr-3 font-normal">Object</th>
                  <th className="py-2 pr-3 text-right font-normal">Errors</th>
                  <th className="py-2 pr-3 font-normal">Breakdown</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {data.fieldLeaderboard.map((row) => (
                  <tr
                    key={`${row.sfObject}-${row.fieldApiName}`}
                    className="border-b last:border-0 transition hover:bg-accent/50"
                  >
                    <td className="py-2 pr-3 font-mono text-xs">{row.fieldApiName}</td>
                    <td className="py-2 pr-3 text-xs">{row.sfObject}</td>
                    <td className="py-2 pr-3 text-right font-mono tabular-nums text-red-600">
                      {row.errors}
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex h-2 w-40 overflow-hidden rounded-full bg-gray-100">
                        {LEADERBOARD_SEGMENTS.map((s) => {
                          const v = row[s.key];
                          if (v <= 0) return null;
                          const w = (v / row.errors) * 100;
                          return (
                            <div
                              key={s.key}
                              className={s.color}
                              style={{ width: `${w}%` }}
                              title={`${s.label}: ${v}`}
                            />
                          );
                        })}
                      </div>
                    </td>
                    <td className="py-2 text-right text-xs">
                      <Link
                        href={`/data-entry/search?field=${encodeURIComponent(
                          row.fieldApiName,
                        )}&outcome=error`}
                        className="text-emerald-700 underline-offset-2 hover:underline"
                      >
                        View rows →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Validation messages (collapsed) ── */}
      {data.validationMessages.length > 0 && (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowValidation((v) => !v)}
            aria-expanded={showValidation}
            className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            <span className="text-[9px]">{showValidation ? '▼' : '▶'}</span>
            Validation messages ({data.validationMessages.length})
          </button>
          {showValidation && (
            <ul className="mt-2 space-y-1">
              {data.validationMessages.map((m) => (
                <li
                  key={m.message}
                  className="flex items-start justify-between gap-3 rounded border bg-background px-2 py-1 text-xs"
                >
                  <span className="font-mono text-muted-foreground">{m.message}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{num(m.count)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Distributions (clickable bars cross-filter Field Health) ── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <DistributionBlock
          title="Write-outcome distribution"
          hint="dry_run is intentional (would-write), not an error."
          rows={data.outcomeDistribution.map((o) => ({ key: o.outcome, count: o.count, pct: o.pct }))}
          neutralKeys={['dry_run']}
        />
        <DistributionBlock
          title="Skip-reason distribution"
          hint="Most common reasons a value wasn't written."
          rows={data.skipReasonDistribution.map((s) => ({ key: s.reason, count: s.count, pct: s.pct }))}
          neutralKeys={['dry_run', 'no_context_found', 'field_not_blank']}
        />
      </div>

      {data.fieldLeaderboard.length > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          Tip: click <span className="font-mono">View rows</span> on a leaderboard field to inspect
          its raw error rows in search.
        </p>
      )}
    </section>
  );
}

function DistributionBlock({
  title,
  hint,
  rows,
  neutralKeys,
}: {
  title: string;
  hint: string;
  rows: Array<{ key: string; count: number; pct: number }>;
  neutralKeys: string[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">None in this period.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((r) => {
            const neutral = neutralKeys.includes(r.key);
            return (
              <li key={r.key} className="flex items-center gap-2 text-xs">
                <span className="w-44 shrink-0 truncate font-mono" title={r.key}>
                  {r.key}
                </span>
                <div className="h-2 flex-1 rounded-full bg-gray-100">
                  <div
                    className={`h-2 rounded-full ${neutral ? 'bg-emerald-400' : 'bg-blue-500'}`}
                    style={{ width: `${(r.count / max) * 100}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                  {num(r.count)}
                </span>
                <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">
                  {r.pct.toFixed(1)}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
