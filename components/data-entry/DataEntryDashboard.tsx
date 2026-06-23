'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { StatusBadge, DryRunBadge } from './StatusBadge';
import type { BatchListItem, QueueItem, HistoryRow } from './types';

const TRIGGER_FILTERS = ['all', 'manual', 'webhook'] as const;

export default function DataEntryDashboard() {
  // ── Quick Run form ────────────────────────────────────
  const [recordId, setRecordId] = useState('');
  const [objectType, setObjectType] = useState<'Lead' | 'Opportunity'>('Lead');
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);

  // ── History ───────────────────────────────────────────
  const [batches, setBatches] = useState<BatchListItem[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadHistory = useCallback((filter?: string) => {
    const activeFilter = filter ?? typeFilter;
    setLoadingHistory(true);
    setHistoryError(null);

    const batchParams = new URLSearchParams({ limit: '100' });
    if (activeFilter !== 'all' && activeFilter !== 'webhook') {
      batchParams.set('trigger_type', activeFilter);
    }

    Promise.all([
      fetch(`/api/data-entry/batches?${batchParams}`),
      fetch('/api/data-entry/queue?limit=100'),
    ])
      .then(async ([batchRes, queueRes]) => {
        if (!batchRes.ok || !queueRes.ok) {
          const failed = !batchRes.ok ? batchRes : queueRes;
          const body = await failed.json().catch(() => ({}));
          throw new Error(body.error ?? `Request failed (${failed.status})`);
        }
        const [batchData, queueData] = await Promise.all([batchRes.json(), queueRes.json()]);
        setBatches(batchData.batches ?? []);
        setQueueItems(queueData.queue ?? []);
      })
      .catch((e) => setHistoryError(e instanceof Error ? e.message : 'Failed to load run history'))
      .finally(() => setLoadingHistory(false));
  }, [typeFilter]);

  // Load once on mount
  useEffect(() => { loadHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Only show queue items that are still in-flight — once dispatched/failed the
  // agent_run becomes the canonical history row. 'pending' = ready/active,
  // 'dispatching' = the cron-driver has it in hand.
  const activeQueueItems = queueItems.filter(
    (q) => q.status === 'pending' || q.status === 'dispatching',
  );

  const historyRows: HistoryRow[] = (() => {
    const rows: HistoryRow[] = [];
    for (const b of batches) rows.push({ kind: 'batch', data: b });
    for (const q of activeQueueItems) rows.push({ kind: 'queued', data: q });
    rows.sort((a, b) =>
      new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime(),
    );
    return rows;
  })();

  const filteredRows = typeFilter === 'all'
    ? historyRows
    : typeFilter === 'webhook'
      ? historyRows.filter(
          (r) =>
            (r.kind === 'queued' && r.data.trigger_event === 'webhook') ||
            (r.kind === 'batch' && r.data.trigger_type === 'webhook'),
        )
      : historyRows.filter((r) => r.kind === 'batch' && r.data.trigger_type === typeFilter);

  const [processingQueueId, setProcessingQueueId] = useState<string | null>(null);
  const [processedQueueId, setProcessedQueueId] = useState<string | null>(null);
  const [processingAll, setProcessingAll] = useState(false);
  const [processAllStatus, setProcessAllStatus] = useState<string | null>(null);

  // Ready = pending and its scheduled time has arrived.
  const readyCount = activeQueueItems.filter(
    (q) => q.status === 'pending' && new Date(q.scheduled_at).getTime() <= Date.now(),
  ).length;

  async function handleProcessAllReady() {
    setProcessingAll(true);
    setProcessAllStatus(null);
    try {
      const res = await fetch('/api/data-entry/queue/process-ready', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setProcessAllStatus(`Error: ${data.error ?? 'Request failed'}`);
        return;
      }
      const n = data.requeued ?? 0;
      setProcessAllStatus(`Re-queued ${n} pending; the cron-driver will dispatch shortly.`);
    } catch (err) {
      setProcessAllStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setProcessingAll(false);
      loadHistory();
    }
  }

  async function handleProcessNow(queueId: string) {
    setProcessingQueueId(queueId);
    try {
      const res = await fetch(`/api/data-entry/queue/${queueId}/skip`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setProcessAllStatus(`Error: ${data.error ?? 'Re-queue failed'}`);
        return;
      }
      setProcessedQueueId(queueId);
      setTimeout(() => setProcessedQueueId(null), 4000);
    } catch (err) {
      setProcessAllStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setProcessingQueueId(null);
      loadHistory();
    }
  }

  function handleFilterChange(filter: string) {
    setTypeFilter(filter);
    loadHistory(filter);
  }

  // ── Quick Run handler ─────────────────────────────────
  async function handleQuickRun() {
    if (!recordId.trim()) return;
    setRunning(true);
    setRunStatus(null);

    try {
      const response = await fetch('/api/data-entry/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: recordId.trim(), objectType, dryRun }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setRunStatus(`Error: ${data.error ?? 'Request failed'}`);
        return;
      }

      setRunStatus(`Queued — the agent will process it shortly (dry_run=${data.dry_run ?? dryRun}).`);
      loadHistory();
    } catch (err) {
      setRunStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Page header ────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Trigger runs and monitor recent activity.
        </p>
      </div>

      {/* ── Quick Run ──────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Quick Run</h2>
        <p className="mt-1 text-sm text-muted-foreground">Queue the agent for a single Lead or Opportunity. The cron-driver dispatches it shortly after.</p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="quick-run-record-id" className="block text-xs font-medium text-muted-foreground mb-1">Record ID</label>
            <input
              id="quick-run-record-id"
              type="text"
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
              placeholder="00Q1234567890AB"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
              disabled={running}
            />
          </div>
          <div>
            <label htmlFor="quick-run-object" className="block text-xs font-medium text-muted-foreground mb-1">Object</label>
            <select
              id="quick-run-object"
              value={objectType}
              onChange={(e) => setObjectType(e.target.value as 'Lead' | 'Opportunity')}
              className="rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
              disabled={running}
            >
              <option value="Lead">Lead</option>
              <option value="Opportunity">Opportunity</option>
            </select>
          </div>
          <div>
            <span className="block text-xs font-medium text-muted-foreground mb-1">Mode</span>
            <ModeToggle active={dryRun} onChange={setDryRun} disabled={running} />
          </div>
          <button
            onClick={handleQuickRun}
            disabled={running || !recordId.trim()}
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
          >
            {running ? 'Queuing...' : 'Run'}
          </button>
        </div>

        {runStatus && (
          <p className={`mt-3 text-sm ${runStatus.startsWith('Error') ? 'text-destructive' : 'text-emerald-700'}`}>
            {runStatus}
          </p>
        )}
      </section>

      {/* ── Run History ───────────────────────────────── */}
      <section className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Run History</h2>
            <div className="flex gap-1" role="group" aria-label="Filter runs by trigger">
              {TRIGGER_FILTERS.map((t) => (
                <button
                  key={t}
                  type="button"
                  disabled={loadingHistory}
                  aria-pressed={typeFilter === t}
                  onClick={() => handleFilterChange(t)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 ${
                    typeFilter === t
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'all' ? 'All' : t}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {readyCount > 0 && (
              <button
                onClick={handleProcessAllReady}
                disabled={processingAll}
                type="button"
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
              >
                {processingAll ? 'Re-queuing...' : `Process ${readyCount} Ready`}
              </button>
            )}
            <button
              onClick={() => loadHistory()}
              disabled={loadingHistory}
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground transition disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 rounded"
            >
              {loadingHistory ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {processAllStatus && (
          <p className={`mt-2 text-sm ${processAllStatus.startsWith('Error') ? 'text-destructive' : 'text-emerald-700'}`}>
            {processAllStatus}
          </p>
        )}

        {loadingHistory ? (
          <div className="mt-4 space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 rounded-lg border px-4 py-3">
                <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                <div className="h-3 w-12 animate-pulse rounded bg-muted" />
                <div className="ml-auto h-5 w-16 animate-pulse rounded-full bg-muted" />
              </div>
            ))}
          </div>
        ) : historyError ? (
          <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <p className="text-sm font-medium text-destructive">Couldn&apos;t load run history</p>
            <p className="mt-1 text-xs text-muted-foreground break-words">{historyError}</p>
            <button
              onClick={() => loadHistory()}
              type="button"
              className="mt-3 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-accent transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
            >
              Retry
            </button>
          </div>
        ) : filteredRows.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {typeFilter === 'all' ? 'No runs yet. Start one above.' : `No ${typeFilter} runs found.`}
          </p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30 text-left text-xs font-medium text-muted-foreground">
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Object</th>
                <th className="px-3 py-2.5">Records</th>
                <th className="px-3 py-2.5">Status</th>
                <th className="px-3 py-2.5">Flags</th>
                <th className="px-3 py-2.5">Created</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) =>
                row.kind === 'batch' ? (
                  <tr key={`b-${row.data.id}`} className="border-b last:border-0 hover:bg-accent/50 transition">
                    <td className="py-2 pr-3">
                      <Link href={`/data-entry/runs/${row.data.id}`} className="font-medium text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 rounded">
                        {row.data.trigger_type}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{row.data.object_type ?? '—'}</td>
                    <td className="py-2 pr-3">
                      {row.data.completed_records + row.data.failed_records}/{row.data.total_records}
                    </td>
                    <td className="py-2 pr-3"><StatusBadge status={row.data.status} /></td>
                    <td className="py-2 pr-3">{row.data.dry_run && <DryRunBadge />}</td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(row.data.created_at).toLocaleString()}
                    </td>
                  </tr>
                ) : (
                  <tr key={`q-${row.data.id}`} className="border-b last:border-0 hover:bg-accent/50 transition">
                    <td className="py-2 pr-3">
                      {row.data.run_id ? (
                        <Link href={`/data-entry/runs/${row.data.run_id}`} className="font-medium text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 rounded">
                          {row.data.trigger_event}
                        </Link>
                      ) : (
                        <span className="font-medium text-muted-foreground">{row.data.trigger_event}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{row.data.object_type ?? '—'}</td>
                    <td className="py-2 pr-3 font-mono text-xs" title={row.data.record_id ?? ''}>
                      {(row.data.record_id ?? '—').slice(0, 15)}
                    </td>
                    <td className="py-2 pr-3"><StatusBadge status={row.data.status} /></td>
                    <td className="py-2 pr-3">
                      {processedQueueId === row.data.id ? (
                        <span className="text-xs text-emerald-700">Re-queued — dispatching shortly</span>
                      ) : row.data.status === 'pending' ? (
                        <button
                          type="button"
                          onClick={() => handleProcessNow(row.data.id)}
                          disabled={processingQueueId === row.data.id}
                          className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
                        >
                          {processingQueueId === row.data.id
                            ? 'Re-queuing...'
                            : `${formatTimeUntil(row.data.scheduled_at)} — Process Now`}
                        </button>
                      ) : null}
                      {row.data.attempts > 0 && row.data.status === 'failed' && (
                        <span className="text-xs text-destructive">
                          {row.data.attempts}/{row.data.max_attempts} attempts
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(row.data.created_at).toLocaleString()}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/** Segmented toggle for Dry Run / Live mode. */
function ModeToggle({
  active,
  onChange,
  disabled,
}: {
  active: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="inline-flex rounded-lg border text-xs font-medium overflow-hidden">
      <button
        type="button"
        onClick={() => onChange(true)}
        disabled={disabled}
        aria-pressed={active}
        className={`px-3 py-2 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 ${
          active
            ? 'bg-sky-100 text-sky-800'
            : 'bg-background text-muted-foreground hover:text-foreground'
        }`}
      >
        Dry Run
      </button>
      <button
        type="button"
        onClick={() => onChange(false)}
        disabled={disabled}
        aria-pressed={!active}
        className={`px-3 py-2 border-l transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 ${
          !active
            ? 'bg-emerald-100 text-emerald-800'
            : 'bg-background text-muted-foreground hover:text-foreground'
        }`}
      >
        Live
      </button>
    </div>
  );
}

function formatTimeUntil(isoDate: string): string {
  const diff = new Date(isoDate).getTime() - Date.now();
  if (diff <= 0) return 'ready';
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `in ${hrs}h ${remainMins}m` : `in ${hrs}h`;
}
