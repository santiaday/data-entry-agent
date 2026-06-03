'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { StatusBadge, DryRunBadge } from './StatusBadge';
import { StatCard } from './StatCard';
import type { BatchListItem, RunListItem } from './types';

type BatchDetail = BatchListItem;
type RunItem = RunListItem;
type Stats = { totalFields: number; totalWritten: number; totalSkipped: number; totalErrored: number };

export default function BatchDetailView({ batchId }: { batchId: string }) {
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/data-entry/batches/${batchId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setBatch(data.batch);
          setRuns(data.runs ?? []);
          setStats(data.stats ?? null);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [batchId]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while running
  useEffect(() => {
    if (batch?.status !== 'running') return;
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [batch?.status, load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border bg-card" />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-xl border bg-card" />
      </div>
    );
  }

  if (error || !batch) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4">
        <p className="text-sm text-destructive">{error ?? 'Batch not found'}</p>
      </div>
    );
  }

  const completedPct = batch.total_records > 0
    ? Math.round(((batch.completed_records + batch.failed_records) / batch.total_records) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold">Batch Detail</h1>
          <StatusBadge status={batch.status} />
          {batch.dry_run && <DryRunBadge />}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {batch.trigger_type} — {batch.object_type}
          {batch.completed_at && ` — ${new Date(batch.completed_at).toLocaleString()}`}
        </p>
      </div>

      {/* ── SOQL query ────────────────────────────────── */}
      {batch.soql_query && (
        <div className="rounded-xl border border-gray-200 bg-gray-900 p-4 font-mono text-xs leading-relaxed text-green-200">
          <pre className="whitespace-pre-wrap break-all">{batch.soql_query}</pre>
        </div>
      )}

      {/* ── Progress bar ──────────────────────────────── */}
      {batch.status === 'running' && (
        <div>
          <div className="flex justify-between text-xs text-muted-foreground mb-1">
            <span>{batch.completed_records + batch.failed_records} / {batch.total_records} records</span>
            <span>{completedPct}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-blue-600 transition-all"
              style={{ width: `${completedPct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Stats ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total Records" value={batch.total_records} />
        <StatCard label="Completed" value={batch.completed_records} />
        <StatCard label="Failed" value={batch.failed_records} />
        {stats && (
          <>
            <StatCard label="Fields Written" value={stats.totalWritten} />
            <StatCard label="Fields Skipped" value={stats.totalSkipped} />
          </>
        )}
      </div>

      {/* ── Per-record table ──────────────────────────── */}
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-accent/30 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2">Record ID</th>
              <th className="px-3 py-2">Object</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Extracted</th>
              <th className="px-3 py-2">Written</th>
              <th className="px-3 py-2">Skipped</th>
              <th className="px-3 py-2">Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b last:border-0 hover:bg-accent/50 transition">
                <td className="px-3 py-2">
                  <Link href={`/data-entry/runs/${run.id}`} className="font-mono text-xs text-blue-600 hover:underline">
                    {run.record_id}
                  </Link>
                </td>
                <td className="px-3 py-2">{run.object_type}</td>
                <td className="px-3 py-2"><StatusBadge status={run.status} /></td>
                <td className="px-3 py-2">{run.fields_extracted}</td>
                <td className="px-3 py-2">{run.fields_written}</td>
                <td className="px-3 py-2">{run.fields_skipped}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {run.duration_ms ? `${(run.duration_ms / 1000).toFixed(1)}s` : '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {runs.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">No runs yet.</p>
        )}
      </div>

      {/* ── Error ─────────────────────────────────────── */}
      {batch.error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4">
          <h3 className="text-sm font-medium text-destructive">Batch Error</h3>
          <p className="mt-1 text-sm text-destructive">{batch.error}</p>
        </div>
      )}
    </div>
  );
}
