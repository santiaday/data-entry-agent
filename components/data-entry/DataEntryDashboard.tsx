'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { StatusBadge, DryRunBadge } from './StatusBadge';
import { BatchFieldSelector } from './BatchFieldSelector';
import type { BatchListItem, QueueItem, HistoryRow, StreamEvent } from './types';

export default function DataEntryDashboard() {
  // ── Quick Run form ────────────────────────────────────
  const [recordId, setRecordId] = useState('');
  const [objectType, setObjectType] = useState<'Lead' | 'Opportunity'>('Lead');
  const [dryRun, setDryRun] = useState(false);
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [runPhase, setRunPhase] = useState<string | null>(null);

  // ── Batch form ────────────────────────────────────────
  const [soqlQuery, setSoqlQuery] = useState('');
  const [batchDryRun, setBatchDryRun] = useState(false);
  const [batchObjectType, setBatchObjectType] = useState<'Lead' | 'Opportunity'>('Lead');
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  // Field scope: all fields, or a specific subset (by SF field API name).
  const [batchScopeAll, setBatchScopeAll] = useState(true);
  const [batchSelectedFields, setBatchSelectedFields] = useState<string[]>([]);

  // ── History ───────────────────────────────────────────
  const [batches, setBatches] = useState<BatchListItem[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadHistory = useCallback((filter?: string) => {
    const activeFilter = filter ?? typeFilter;
    setLoadingHistory(true);

    const batchParams = new URLSearchParams({ limit: '100' });
    if (activeFilter !== 'all' && activeFilter !== 'webhook') {
      batchParams.set('trigger_type', activeFilter);
    }

    Promise.all([
      fetch(`/api/data-entry/batches?${batchParams}`).then((r) => r.json()),
      fetch('/api/data-entry/queue?limit=100').then((r) => r.json()),
    ])
      .then(([batchData, queueData]) => {
        setBatches(batchData.batches ?? []);
        setQueueItems(queueData.queue ?? []);
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [typeFilter]);

  // Load once on mount
  useEffect(() => { loadHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Only show queue items that are still pending — once processed, the
  // pipeline's batch row is the canonical entry in the history.
  const activeQueueItems = queueItems.filter(
    (q) => q.status === 'waiting' || q.status === 'processing',
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
      ? historyRows.filter((r) => r.kind === 'queued' || (r.kind === 'batch' && r.data.trigger_type === 'webhook'))
      : historyRows.filter((r) => r.kind === 'batch' && r.data.trigger_type === typeFilter);

  const [processingQueueId, setProcessingQueueId] = useState<string | null>(null);
  const [processingAll, setProcessingAll] = useState(false);
  const [processAllStatus, setProcessAllStatus] = useState<string | null>(null);

  const readyCount = activeQueueItems.filter(
    (q) => q.status === 'waiting' && new Date(q.scheduled_at).getTime() <= Date.now(),
  ).length;

  async function handleProcessAllReady() {
    setProcessingAll(true);
    setProcessAllStatus('Starting...');
    let totalProcessed = 0;
    let totalFailed = 0;

    try {
      // Keep calling until no more ready jobs
      while (true) {
        const res = await fetch('/api/data-entry/queue/process-ready', { method: 'POST' });
        const data = await res.json();

        if (!res.ok) {
          setProcessAllStatus(`Error: ${data.error}`);
          break;
        }

        totalProcessed += data.succeeded;
        totalFailed += data.failed;

        if (data.processed === 0 || data.remaining === 0) {
          setProcessAllStatus(
            `Done: ${totalProcessed} processed${totalFailed > 0 ? `, ${totalFailed} failed` : ''}`,
          );
          break;
        }

        setProcessAllStatus(
          `Processing... ${totalProcessed} done, ${data.remaining} remaining`,
        );
        loadHistory();
      }
    } catch (err) {
      setProcessAllStatus(`Error: ${err instanceof Error ? err.message : 'Unknown'}`);
    } finally {
      setProcessingAll(false);
      loadHistory();
    }
  }

  async function handleProcessNow(queueId: string) {
    setProcessingQueueId(queueId);
    try {
      const res = await fetch(`/api/data-entry/queue/${queueId}/skip`, { method: 'POST' });
      const data = await res.json();
      if (data.runId) {
        window.location.href = `/data-entry/runs/${data.runId}`;
      } else {
        loadHistory();
      }
    } catch {
      loadHistory();
    } finally {
      setProcessingQueueId(null);
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
    setRunPhase(null);

    try {
      const response = await fetch('/api/data-entry/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recordId: recordId.trim(), objectType, dryRun }),
      });

      if (!response.ok) {
        const err = await response.json();
        setRunStatus(`Error: ${err.error}`);
        setRunning(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';
      let resultRunId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as StreamEvent;
            if (event.type === 'phase') {
              setRunPhase(`${event.phase}: ${event.status}`);
            } else if (event.type === 'done') {
              resultRunId = event.runId;
              setRunStatus(`Done: ${event.summary.extracted} extracted, ${event.summary.written} written, ${event.summary.skipped} skipped`);
            } else if (event.type === 'error') {
              setRunStatus(`Error: ${event.error}`);
            }
          } catch { /* skip malformed events */ }
        }
      }

      setRunning(false);
      loadHistory();

      if (resultRunId) {
        setTimeout(() => {
          window.location.href = `/data-entry/runs/${resultRunId}`;
        }, 1500);
      }
    } catch (err) {
      setRunStatus(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setRunning(false);
    }
  }

  // ── Batch handler ─────────────────────────────────────
  async function handleBatchRun() {
    if (!soqlQuery.trim()) return;
    setBatchRunning(true);
    setBatchError(null);

    const fieldNames = batchScopeAll ? undefined : batchSelectedFields;

    try {
      const response = await fetch('/api/data-entry/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          soqlQuery: soqlQuery.trim(),
          objectType: batchObjectType,
          dryRun: batchDryRun,
          ...(fieldNames && fieldNames.length > 0 ? { fieldNames } : {}),
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setBatchError(data.error);
      } else {
        loadHistory();
        setSoqlQuery('');
      }
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBatchRunning(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* ── Quick Run ──────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Quick Run</h2>
        <p className="mt-1 text-sm text-muted-foreground">Run the agent for a single Lead or Opportunity</p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Record ID</label>
            <input
              type="text"
              value={recordId}
              onChange={(e) => setRecordId(e.target.value)}
              placeholder="00Q1234567890AB"
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-200"
              disabled={running}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Object</label>
            <select
              value={objectType}
              onChange={(e) => setObjectType(e.target.value as 'Lead' | 'Opportunity')}
              className="rounded-lg border bg-background px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-200"
              disabled={running}
            >
              <option value="Lead">Lead</option>
              <option value="Opportunity">Opportunity</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Mode</label>
            <ModeToggle active={dryRun} onChange={setDryRun} disabled={running} />
          </div>
          <button
            onClick={handleQuickRun}
            disabled={running || !recordId.trim()}
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition"
          >
            {running ? 'Running...' : 'Run'}
          </button>
        </div>

        {runPhase && running && (
          <p className="mt-3 text-sm text-muted-foreground animate-pulse">{runPhase}</p>
        )}
        {runStatus && (
          <p className={`mt-3 text-sm ${runStatus.startsWith('Error') ? 'text-destructive' : 'text-green-700'}`}>
            {runStatus}
          </p>
        )}
      </section>

      {/* ── Batch Run ─────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Batch Run</h2>
        <p className="mt-1 text-sm text-muted-foreground">Run against multiple records via SOQL query. Scope to specific fields to cut cost on targeted backfills.</p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">SOQL Query</label>
            <textarea
              value={soqlQuery}
              onChange={(e) => setSoqlQuery(e.target.value)}
              placeholder="SELECT Id FROM Lead WHERE Status = 'Demo Completed' AND AI_Buyer_Persona__c = null LIMIT 5"
              rows={2}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono transition focus:outline-none focus:ring-2 focus:ring-emerald-200"
              disabled={batchRunning}
            />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Object</label>
              <select
                value={batchObjectType}
                onChange={(e) => {
                  setBatchObjectType(e.target.value as 'Lead' | 'Opportunity');
                  // Field names differ per object — reset the subset selection.
                  setBatchSelectedFields([]);
                }}
                className="rounded-md border bg-background px-3 py-2 text-sm"
                disabled={batchRunning}
              >
                <option value="Lead">Lead</option>
                <option value="Opportunity">Opportunity</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">Mode</label>
              <ModeToggle active={batchDryRun} onChange={setBatchDryRun} disabled={batchRunning} />
            </div>
          </div>

          <BatchFieldSelector
            objectType={batchObjectType}
            disabled={batchRunning}
            scopeAll={batchScopeAll}
            selectedFields={batchSelectedFields}
            onScopeAllChange={setBatchScopeAll}
            onSelectedFieldsChange={setBatchSelectedFields}
          />

          <div className="flex items-center gap-3">
            <button
              onClick={handleBatchRun}
              disabled={batchRunning || !soqlQuery.trim() || (!batchScopeAll && batchSelectedFields.length === 0)}
              type="button"
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition"
            >
              {batchRunning ? 'Starting...' : 'Start Batch'}
            </button>
            {!batchScopeAll && (
              <span className="text-xs text-muted-foreground">
                {batchSelectedFields.length === 0
                  ? 'Select at least one field'
                  : `${batchSelectedFields.length} field${batchSelectedFields.length === 1 ? '' : 's'} will be processed`}
              </span>
            )}
          </div>
        </div>

        {batchError && (
          <p className="mt-3 text-sm text-destructive">{batchError}</p>
        )}
      </section>

      {/* ── Run History ───────────────────────────────── */}
      <section className="rounded-xl border bg-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold">Run History</h2>
            <div className="flex gap-1">
              {['all', 'manual', 'soql_query', 'webhook', 'cli'].map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleFilterChange(t)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    typeFilter === t
                      ? 'bg-foreground text-background'
                      : 'bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {t === 'all' ? 'All' : t === 'soql_query' ? 'batch' : t}
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
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition"
              >
                {processingAll ? 'Processing...' : `Process ${readyCount} Ready`}
              </button>
            )}
            <button
              onClick={() => loadHistory()}
              type="button"
              className="text-sm text-muted-foreground hover:text-foreground transition"
            >
              Refresh
            </button>
          </div>
        </div>

        {processAllStatus && (
          <p className={`mt-2 text-sm ${processAllStatus.startsWith('Error') ? 'text-destructive' : processAllStatus.startsWith('Done') ? 'text-green-700' : 'text-amber-700 animate-pulse'}`}>
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
                      <Link href={`/data-entry/batches/${row.data.id}`} className="font-medium text-blue-600 hover:underline">
                        {row.data.trigger_type}
                      </Link>
                    </td>
                    <td className="py-2 pr-3">{row.data.object_type}</td>
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
                        <Link href={`/data-entry/runs/${row.data.run_id}`} className="font-medium text-blue-600 hover:underline">
                          webhook
                        </Link>
                      ) : (
                        <span className="font-medium text-muted-foreground">webhook</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">{row.data.object_type}</td>
                    <td className="py-2 pr-3 font-mono text-xs" title={row.data.record_id}>
                      {row.data.record_id.slice(0, 15)}
                    </td>
                    <td className="py-2 pr-3"><StatusBadge status={row.data.status} /></td>
                    <td className="py-2 pr-3">
                      {row.data.status === 'waiting' && (
                        <button
                          type="button"
                          onClick={() => handleProcessNow(row.data.id)}
                          disabled={processingQueueId === row.data.id}
                          className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50 transition"
                        >
                          {processingQueueId === row.data.id
                            ? 'Processing...'
                            : `${formatTimeUntil(row.data.scheduled_at)} — Process Now`}
                        </button>
                      )}
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
        className={`px-3 py-2 transition ${
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
        className={`px-3 py-2 border-l transition ${
          !active
            ? 'bg-green-100 text-green-800'
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
