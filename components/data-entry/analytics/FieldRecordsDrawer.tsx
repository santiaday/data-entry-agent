'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api/client';
import { salesforceRecordUrl } from '@/lib/constants';
import { WriteStatusBadge } from '../StatusBadge';
import { confidenceDot, relativeTime } from './types';
import type { FieldRecordRow, FieldRecordsResponse } from './types';

type Filter = 'all' | 'errors' | 'misses';

const CONFIDENCE_LABEL_TO_NUMBER: Record<string, number> = { high: 0.95, medium: 0.75, low: 0.4 };

export function FieldRecordsDrawer({
  sfObject,
  fieldApiName,
  days,
  onClose,
}: {
  sfObject: string;
  fieldApiName: string;
  days: number;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [rows, setRows] = useState<FieldRecordRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    (nextOffset: number, append: boolean) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        sfObject,
        fieldApiName,
        days: String(days),
        filter,
        offset: String(nextOffset),
      });
      apiFetch(`/field-records?${params}`)
        .then(async (r) => {
          const data = (await r.json().catch(() => ({}))) as Partial<FieldRecordsResponse> & {
            error?: string;
          };
          if (!r.ok) throw new Error(data.error ?? `Failed to load (${r.status})`);
          return data as FieldRecordsResponse;
        })
        .then((data) => {
          setRows((prev) => (append ? [...prev, ...data.records] : data.records));
          setHasMore(data.hasMore);
          setOffset(nextOffset);
        })
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
        .finally(() => setLoading(false));
    },
    [sfObject, fieldApiName, days, filter],
  );

  useEffect(() => {
    load(0, false);
  }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-mono text-sm font-semibold">{fieldApiName}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {sfObject} · non-success attempts in the last {days} days
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-2 py-1 text-xs hover:bg-accent"
          >
            Close
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          {(['all', 'errors', 'misses'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                filter === f
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-border bg-background text-muted-foreground hover:bg-accent'
              }`}
            >
              {f === 'all' ? 'All' : f === 'errors' ? 'Errors' : 'Misses'}
            </button>
          ))}
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        {!error && !loading && rows.length === 0 && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            No non-success attempts for this field in the selected range.
          </p>
        )}

        <div className="mt-4 space-y-2">
          {rows.map((r) => (
            <div key={`${r.record_id}-${r.run_id}`} className="rounded-xl border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={salesforceRecordUrl(sfObject, r.record_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-emerald-700 hover:underline"
                >
                  {r.record_id}
                </a>
                <WriteStatusBadge
                  wasWritten={r.was_written}
                  skipReason={r.skip_reason}
                  hasErrors={(r.validation_errors ?? []).length > 0}
                />
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${confidenceDot(
                    CONFIDENCE_LABEL_TO_NUMBER[r.confidence_label ?? ''] ?? 0,
                  )}`}
                />
                <span>{r.skip_reason ?? r.write_outcome ?? '—'}</span>
                <span>{relativeTime(r.created_at)}</span>
                <Link href={`/data-entry/runs/${r.run_id}`} className="ml-auto hover:underline">
                  View run →
                </Link>
              </div>
              {r.evidence && (
                <p className="mt-2 truncate text-xs text-muted-foreground" title={r.evidence}>
                  {r.evidence}
                </p>
              )}
            </div>
          ))}
        </div>

        {hasMore && (
          <button
            type="button"
            onClick={() => load(offset + 50, true)}
            disabled={loading}
            className="mt-4 w-full rounded-lg border py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>
    </div>
  );
}
