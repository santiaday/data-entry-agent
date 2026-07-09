'use client';

import { useMemo, useState } from 'react';
import type { FieldHealth } from './types';
import {
  ATTENTION_META,
  barColor,
  confidenceDot,
  relativeTime,
} from './types';
import { RateBar } from './MiniSpark';

type SortKey =
  | 'attention'
  | 'fieldApiName'
  | 'sfObject'
  | 'attempts'
  | 'populateRate'
  | 'writeRate'
  | 'errored'
  | 'avgConfidence'
  | 'lastSeenAt';

type SortDir = 'asc' | 'desc';

export type FieldChip = 'needs_attention' | 'errors_only' | 'never_extracted';

const ATTENTION_SEVERITY: Record<FieldHealth['attention'], number> = {
  high_error: 4,
  low_populate: 3,
  low_confidence: 2,
  never_extracted: 1,
  ok: 0,
};

/**
 * FieldHealthTable — the page centerpiece. One row per (object, field) with
 * populate/write bars, error count+rate, avg-confidence dot, dominant skip
 * reason, last value, last seen, and an attention badge. Sortable headers
 * (client-side; ≤114 rows already aggregated) and quick-filter chips.
 */
export function FieldHealthTable({
  fields,
  chips,
  onToggleChip,
  onSelectField,
}: {
  fields: FieldHealth[];
  chips: Set<FieldChip>;
  onToggleChip: (c: FieldChip) => void;
  onSelectField: (f: FieldHealth) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>('attention');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'fieldApiName' || key === 'sfObject' ? 'asc' : 'desc');
    }
  };

  const filtered = useMemo(() => {
    let rows = fields;
    if (chips.has('needs_attention')) rows = rows.filter((f) => f.attention !== 'ok');
    if (chips.has('errors_only')) rows = rows.filter((f) => f.errored > 0);
    if (chips.has('never_extracted')) rows = rows.filter((f) => f.attention === 'never_extracted');
    return rows;
  }, [fields, chips]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'attention':
          cmp = ATTENTION_SEVERITY[a.attention] - ATTENTION_SEVERITY[b.attention];
          if (cmp === 0) cmp = a.errorRate - b.errorRate;
          if (cmp === 0) cmp = a.attempts - b.attempts;
          break;
        case 'fieldApiName':
          cmp = a.fieldApiName.localeCompare(b.fieldApiName);
          break;
        case 'sfObject':
          cmp = a.sfObject.localeCompare(b.sfObject);
          break;
        case 'attempts':
          cmp = a.attempts - b.attempts;
          break;
        case 'populateRate':
          cmp = a.populateRate - b.populateRate;
          break;
        case 'writeRate':
          cmp = a.writeRate - b.writeRate;
          break;
        case 'errored':
          cmp = a.errored - b.errored || a.errorRate - b.errorRate;
          break;
        case 'avgConfidence':
          cmp = a.avgConfidence - b.avgConfidence;
          break;
        case 'lastSeenAt':
          cmp =
            new Date(a.lastSeenAt ?? 0).getTime() - new Date(b.lastSeenAt ?? 0).getTime();
          break;
      }
      return cmp * dir;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const chipLabels: Array<{ id: FieldChip; label: string }> = [
    { id: 'needs_attention', label: 'Needs attention' },
    { id: 'errors_only', label: 'Errors only' },
    { id: 'never_extracted', label: 'Never extracted' },
  ];

  return (
    <section id="field-health" className="rounded-xl border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Field Health</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Per field: did the LLM find a value (populate %), would it write (write %), is it
            erroring, and is it producing sane output (last value). Click a column to re-sort.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {chipLabels.map((c) => {
            const active = chips.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={active}
                onClick={() => onToggleChip(c.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 ${
                  active
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-border bg-background text-muted-foreground hover:bg-accent'
                }`}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <SortHeader label="Field" col="fieldApiName" {...{ sortKey, sortDir, toggleSort }} />
              <SortHeader label="Object" col="sfObject" {...{ sortKey, sortDir, toggleSort }} />
              <SortHeader label="Attempts" col="attempts" align="right" {...{ sortKey, sortDir, toggleSort }} />
              <SortHeader label="Populate %" col="populateRate" {...{ sortKey, sortDir, toggleSort }} />
              <SortHeader label="Write %" col="writeRate" {...{ sortKey, sortDir, toggleSort }} />
              <SortHeader label="Errors" col="errored" align="right" {...{ sortKey, sortDir, toggleSort }} />
              <SortHeader label="Conf" col="avgConfidence" align="center" {...{ sortKey, sortDir, toggleSort }} />
              <th className="py-2 pr-3 font-normal">Dominant reason</th>
              <th className="py-2 pr-3 font-normal">Last value</th>
              <SortHeader label="Last seen" col="lastSeenAt" {...{ sortKey, sortDir, toggleSort }} />
              <SortHeader label="Status" col="attention" {...{ sortKey, sortDir, toggleSort }} />
            </tr>
          </thead>
          <tbody>
            {sorted.map((f) => {
              const att = ATTENTION_META[f.attention];
              return (
                <tr
                  key={`${f.sfObject}-${f.fieldApiName}`}
                  onClick={() => onSelectField(f)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onSelectField(f)}
                  className="cursor-pointer border-b last:border-0 align-top transition hover:bg-accent/50"
                >
                  <td className="py-2 pr-3 font-mono text-xs">{f.fieldApiName}</td>
                  <td className="py-2 pr-3 text-xs">
                    <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px]">
                      {f.sfObject}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-mono tabular-nums">{f.attempts}</td>
                  <td className="py-2 pr-3">
                    {f.attempts > 0 ? (
                      <RateBar rate={f.populateRate} barColorClass={barColor(f.populateRate)} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {f.attempts > 0 ? (
                      <RateBar rate={f.writeRate} barColorClass={barColor(f.writeRate)} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {f.errored > 0 ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="font-mono tabular-nums text-red-600">{f.errored}</span>
                        <span className="rounded bg-red-50 px-1 text-[10px] font-medium text-red-700">
                          {(f.errorRate * 100).toFixed(0)}%
                        </span>
                      </span>
                    ) : (
                      <span className="font-mono text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-center">
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${confidenceDot(f.avgConfidence)}`}
                      title={f.avgConfidence > 0 ? `avg confidence ${(f.avgConfidence * 100).toFixed(0)}%` : 'no confidence data'}
                    />
                  </td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-muted-foreground">
                    {f.dominantSkipReason ?? '—'}
                  </td>
                  <td className="max-w-[200px] py-2 pr-3 text-xs">
                    {f.lastValue ? (
                      <span className="block truncate" title={f.lastValue}>
                        {f.lastValue}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground" title={f.lastSeenAt ?? undefined}>
                    {relativeTime(f.lastSeenAt)}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${att.className}`}
                    >
                      {att.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No fields match the current filters.
        </p>
      )}
    </section>
  );
}

function SortHeader({
  label,
  col,
  sortKey,
  sortDir,
  toggleSort,
  align = 'left',
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  toggleSort: (k: SortKey) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const active = sortKey === col;
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`py-2 pr-3 font-normal ${alignCls}`}>
      <button
        type="button"
        onClick={() => toggleSort(col)}
        className={`inline-flex items-center gap-1 rounded transition hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 ${
          active ? 'text-foreground' : ''
        }`}
      >
        {label}
        <span className="text-[9px]">{active ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}
