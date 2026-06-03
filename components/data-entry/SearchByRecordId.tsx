'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { StatusBadge, DryRunBadge } from './StatusBadge';
import type { RunListItem, QueueItem } from './types';

type RunWithError = RunListItem & { error: string | null };

export default function SearchByRecordId({ initialRecordId }: { initialRecordId: string }) {
  const [recordId, setRecordId] = useState(initialRecordId);
  const [runs, setRuns] = useState<RunWithError[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const search = useCallback(async (rid: string) => {
    if (!rid.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const [runRes, queueRes] = await Promise.all([
        fetch(`/api/data-entry/search?recordId=${encodeURIComponent(rid.trim())}`),
        fetch(`/api/data-entry/queue?recordId=${encodeURIComponent(rid.trim())}`),
      ]);
      const [runData, queueData] = await Promise.all([runRes.json(), queueRes.json()]);
      setRuns(runData.runs ?? []);
      setQueueItems(queueData.queue ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const [processingQueueId, setProcessingQueueId] = useState<string | null>(null);

  async function handleProcessNow(queueId: string) {
    setProcessingQueueId(queueId);
    try {
      const res = await fetch(`/api/data-entry/queue/${queueId}/skip`, { method: 'POST' });
      const data = await res.json();
      if (data.runId) {
        window.location.href = `/data-entry/runs/${data.runId}`;
      } else {
        search(recordId);
      }
    } catch {
      search(recordId);
    } finally {
      setProcessingQueueId(null);
    }
  }

  // Auto-search if query param was provided on page load
  useEffect(() => {
    if (initialRecordId && initialRecordId.length >= 3) {
      search(initialRecordId);
    }
  }, [initialRecordId, search]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Search Runs by Record ID</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Find every time the Data Entry Agent touched a specific Lead or Opportunity.
        </p>
      </div>

      {/* Search input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          search(recordId);
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          value={recordId}
          onChange={(e) => setRecordId(e.target.value)}
          placeholder="006QU00000kz8CgYAI"
          className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm font-mono transition focus:outline-none focus:ring-2 focus:ring-emerald-200"
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || recordId.trim().length < 3}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {/* Results */}
      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 rounded-xl border bg-card px-4 py-4">
              <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-24 animate-pulse rounded bg-muted" />
              <div className="ml-auto h-3 w-32 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      )}

      {/* Queued items */}
      {!loading && queueItems.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            Queued ({queueItems.length})
          </p>
          <div className="space-y-2">
            {queueItems.map((q) => (
              <div
                key={q.id}
                className="flex items-center justify-between rounded-xl border bg-card p-4"
              >
                <div className="flex items-center gap-3">
                  <StatusBadge status={q.status} />
                  <span className="text-sm">{q.object_type}</span>
                  <span className="text-xs text-muted-foreground">
                    {q.trigger_event} — {new Date(q.created_at).toLocaleString()}
                  </span>
                  {q.last_error && (
                    <span className="text-xs text-destructive">{q.last_error}</span>
                  )}
                </div>
                {q.status === 'waiting' && (
                  <button
                    type="button"
                    onClick={() => handleProcessNow(q.id)}
                    disabled={processingQueueId === q.id}
                    className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition"
                  >
                    {processingQueueId === q.id ? 'Processing...' : 'Process Now'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && searched && runs.length === 0 && queueItems.length === 0 && (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No runs or queued items found for <span className="font-mono">{recordId}</span>.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            If the agent definitely ran for this record but no row appears here, something blocked the run
            from writing to Supabase before it could log. Check the CLI output or server logs.
          </p>
        </div>
      )}

      {!loading && runs.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">
            Runs ({runs.length})
          </p>

          <div className="space-y-2">
            {runs.map((run) => (
              <Link
                key={run.id}
                href={`/data-entry/runs/${run.id}`}
                className="block rounded-xl border bg-card p-4 hover:bg-accent/50 transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={run.status} />
                      {run.dry_run && <DryRunBadge />}
                      <span className="text-xs text-muted-foreground">
                        {new Date(run.created_at).toLocaleString()}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
                      <span>{run.fields_extracted} extracted</span>
                      <span>{run.fields_written} written</span>
                      <span>{run.fields_skipped} skipped</span>
                      {run.fields_errored > 0 && (
                        <span className="text-destructive">{run.fields_errored} errored</span>
                      )}
                      {run.duration_ms && (
                        <span>{(run.duration_ms / 1000).toFixed(1)}s</span>
                      )}
                    </div>

                    {run.error && (
                      <pre className="mt-3 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                        {run.error}
                      </pre>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">→</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
