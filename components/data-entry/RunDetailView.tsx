'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatusBadge, WriteStatusBadge, DryRunBadge } from './StatusBadge';
import { StatCard } from './StatCard';
import { ConfidenceBar } from './ConfidenceBar';
import type { RunListItem, ExtractionRow, PhaseTimingRow, BatchExecutionRow, WriteResultRow, FetchInventoryRow } from './types';

type RunDetail = RunListItem & {
  batch_id: string;
  fetch_errors: { source: string; error: string }[] | null;
  batch_errors: { batchId: string; error: string }[] | null;
  write_results: WriteResultRow[] | null;
  fetch_inventory: FetchInventoryRow[] | null;
  phase_timings: PhaseTimingRow[] | null;
  batch_executions: BatchExecutionRow[] | null;
  total_prompt_tokens: number | null;
  total_completion_tokens: number | null;
  de_batches?: { trigger_type: string; soql_query: string | null; dry_run: boolean };
};

export default function RunDetailView({
  run,
  extractions,
  batchSummary,
}: {
  run: RunDetail;
  extractions: ExtractionRow[];
  batchSummary: Record<string, { total: number; written: number; skipped: number; errored: number }>;
}) {
  const [filterBatch, setFilterBatch] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Get unique batch IDs for the filter
  const batchIds = [...new Set(extractions.map((e) => e.batch_id))].sort();

  // Filter extractions
  const filtered = extractions.filter((e) => {
    if (filterBatch !== 'all' && e.batch_id !== filterBatch) return false;
    if (filterStatus === 'written' && !e.was_written) return false;
    if (filterStatus === 'skipped' && (e.was_written || (e.validation_errors && e.validation_errors.length > 0))) return false;
    if (filterStatus === 'error' && (!e.validation_errors || e.validation_errors.length === 0)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold">Run Detail</h1>
            <StatusBadge status={run.status} />
            {run.dry_run && <DryRunBadge />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {run.object_type} <span className="font-mono">{run.record_id}</span>
            {run.duration_ms ? ` — ${(run.duration_ms / 1000).toFixed(1)}s` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link
            href={`/data-entry/search?recordId=${encodeURIComponent(run.record_id)}`}
            className="text-muted-foreground hover:text-foreground transition"
          >
            All runs for this record
          </Link>
          {run.batch_id ? (
            <Link
              href={`/data-entry/batches/${run.batch_id}`}
              className="text-blue-600 hover:underline"
            >
              View Batch
            </Link>
          ) : null}
        </div>
      </div>

      {/* ── Run-level error (prominent when present) ─── */}
      {run.error && (
        <section className="rounded-xl border-2 border-destructive/60 bg-destructive/5 p-5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive/20 text-xs text-destructive" aria-hidden="true">!</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-destructive">Run Failed</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                The full error captured at failure time is below. Phase, error class, and stack trace included.
              </p>
              <pre className="mt-3 overflow-x-auto rounded border border-destructive/20 bg-white p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
                {run.error}
              </pre>
            </div>
          </div>
        </section>
      )}

      {/* ── Stats ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Extracted" value={run.fields_extracted} />
        <StatCard label="Written" value={run.fields_written} />
        <StatCard label="Skipped" value={run.fields_skipped} />
        <StatCard label="Errors" value={run.fields_errored} />
      </div>

      {/* ── Context Found ─────────────────────────────── */}
      {run.fetch_inventory && run.fetch_inventory.length > 0 && (
        <ContextFoundPanel items={run.fetch_inventory} />
      )}

      {/* ── Performance ───────────────────────────────── */}
      <PerformancePanel run={run} />

      {/* ── Write Verification ────────────────────────── */}
      {run.write_results && run.write_results.length > 0 && (
        <WriteVerificationPanel results={run.write_results} />
      )}

      {/* ── Errors ────────────────────────────────────── */}
      {run.fetch_errors && run.fetch_errors.length > 0 && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4">
          <h3 className="text-sm font-medium text-destructive">Fetch Errors</h3>
          <ul className="mt-2 space-y-1 text-sm text-destructive">
            {run.fetch_errors.map((e, i) => (
              <li key={i}>{e.source}: {e.error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Filters ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Batch</label>
          <select
            value={filterBatch}
            onChange={(e) => setFilterBatch(e.target.value)}
            className="rounded-lg border bg-background px-2 py-1.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-200"
          >
            <option value="all">All batches</option>
            {batchIds.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Status</label>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="rounded-lg border bg-background px-2 py-1.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-emerald-200"
          >
            <option value="all">All</option>
            <option value="written">Written</option>
            <option value="skipped">Skipped</option>
            <option value="error">Errors</option>
          </select>
        </div>
        <p className="ml-auto text-xs text-muted-foreground self-end">
          {filtered.length} of {extractions.length} fields
        </p>
      </div>

      {/* ── Extractions table ─────────────────────────── */}
      <div className="rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-accent/30 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2">Field</th>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2">Extracted</th>
              <th className="px-3 py-2">Before</th>
              <th className="px-3 py-2">SF After</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ext) => (
              <ExtractionTableRow
                key={ext.id}
                extraction={ext}
                expanded={expandedRow === ext.id}
                onToggle={() => setExpandedRow(expandedRow === ext.id ? null : ext.id)}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="p-4 text-center text-sm text-muted-foreground">No extractions match the current filters.</p>
        )}
      </div>
    </div>
  );
}

function ExtractionTableRow({
  extraction: ext,
  expanded,
  onToggle,
}: {
  extraction: ExtractionRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasErrors = (ext.validation_errors ?? []).length > 0;
  const silentlyDropped = ext.skip_reason === 'write_silently_dropped';
  const sfRejected = ext.skip_reason === 'sf_rejected';
  const writeFailed = ext.skip_reason === 'write_failed';
  const afterValue = ext.actual_sf_value_after_write;

  const rowBg = ext.was_written
    ? 'bg-green-50/50'
    : sfRejected
      ? 'bg-red-50/60'
      : silentlyDropped
        ? 'bg-orange-50/60'
        : writeFailed
          ? 'bg-red-50/50'
          : hasErrors
            ? 'bg-red-50/50'
            : ext.skip_reason === 'dry_run'
              ? 'bg-sky-50/50'
              : '';

  return (
    <>
      <tr
        className={`border-b last:border-0 cursor-pointer hover:bg-accent/50 transition ${rowBg}`}
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-mono text-xs">{ext.field_name}</td>
        <td className="px-3 py-2 text-xs text-muted-foreground">{ext.batch_id}</td>
        <td className="px-3 py-2 max-w-[180px] truncate" title={ext.extracted_value ?? ''}>
          {ext.extracted_value ?? <span className="text-muted-foreground">null</span>}
        </td>
        <td className="px-3 py-2 max-w-[180px] truncate text-muted-foreground" title={ext.current_sf_value ?? ''}>
          {ext.current_sf_value ?? '--'}
        </td>
        <td
          className={`px-3 py-2 max-w-[180px] truncate ${
            silentlyDropped ? 'text-orange-700 font-medium'
              : sfRejected ? 'text-red-700 font-medium'
              : 'text-muted-foreground'
          }`}
          title={afterValue ?? ''}
        >
          {afterValue ?? '--'}
        </td>
        <td className="px-3 py-2"><ConfidenceBar confidence={ext.confidence} /></td>
        <td className="px-3 py-2">
          <WriteStatusBadge
            wasWritten={ext.was_written}
            skipReason={ext.skip_reason}
            hasErrors={hasErrors}
          />
        </td>
      </tr>
      {expanded && (
        <tr className={rowBg}>
          <td colSpan={7} className="px-3 py-3 border-b">
            <div className="space-y-2 text-xs">
              <div>
                <span className="font-medium">Write Mode:</span> {ext.write_mode}
                {ext.skip_reason && <span className="ml-3 text-muted-foreground">Skip reason: {ext.skip_reason}</span>}
              </div>
              {ext.evidence && (
                <div>
                  <span className="font-medium">Evidence:</span>
                  <blockquote className="mt-1 border-l-2 border-muted pl-3 text-muted-foreground italic">
                    {ext.evidence}
                  </blockquote>
                </div>
              )}
              {hasErrors && (
                <div>
                  <span className="font-medium text-destructive">Validation Errors:</span>
                  <ul className="mt-1 list-disc pl-4 text-destructive">
                    {(ext.validation_errors ?? []).map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Performance Panel ──────────────────────────────────────

function PerformancePanel({ run }: { run: {
  phase_timings: PhaseTimingRow[] | null;
  batch_executions: BatchExecutionRow[] | null;
  total_prompt_tokens: number | null;
  total_completion_tokens: number | null;
  duration_ms: number | null;
} }) {
  const phases = run.phase_timings ?? [];
  const batches = run.batch_executions ?? [];
  const totalPromptTokens = run.total_prompt_tokens ?? 0;
  const totalCompletionTokens = run.total_completion_tokens ?? 0;

  if (phases.length === 0 && batches.length === 0) return null;

  // Rough cost estimate — gpt-4o pricing as of 2025:
  // $2.50 / 1M input tokens, $10.00 / 1M output tokens.
  const estCostUsd =
    (totalPromptTokens * 2.5 + totalCompletionTokens * 10) / 1_000_000;

  const totalPhaseMs = phases.reduce((s, p) => s + p.durationMs, 0);
  const maxPhaseMs = Math.max(...phases.map((p) => p.durationMs), 1);

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Performance</h3>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{totalPromptTokens.toLocaleString()} in</span>
          <span>{totalCompletionTokens.toLocaleString()} out</span>
          <span>~${estCostUsd.toFixed(4)} est.</span>
        </div>
      </div>

      {/* Phase bars */}
      {phases.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {phases.map((p) => (
            <div key={p.phase} className="flex items-center gap-3">
              <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{p.phase}</span>
              <div className="relative h-5 flex-1 rounded bg-gray-100">
                <div
                  className="absolute inset-y-0 left-0 rounded bg-blue-500"
                  style={{ width: `${(p.durationMs / maxPhaseMs) * 100}%` }}
                />
              </div>
              <span className="w-16 shrink-0 text-right font-mono text-xs">
                {(p.durationMs / 1000).toFixed(2)}s
              </span>
            </div>
          ))}
          <div className="pt-1 text-right text-xs text-muted-foreground">
            Total phases: {(totalPhaseMs / 1000).toFixed(2)}s
            {run.duration_ms && run.duration_ms !== totalPhaseMs && (
              <span className="ml-2">(run: {(run.duration_ms / 1000).toFixed(2)}s)</span>
            )}
          </div>
        </div>
      )}

      {/* Batch table */}
      {batches.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            Per-batch breakdown ({batches.length} batches)
          </summary>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-normal">Batch</th>
                <th className="py-1.5 pr-3 font-normal">Duration</th>
                <th className="py-1.5 pr-3 font-normal">In tokens</th>
                <th className="py-1.5 pr-3 font-normal">Out tokens</th>
                <th className="py-1.5 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.batchId} className="border-b last:border-0">
                  <td className="py-1.5 pr-3 font-mono">{b.batchId}</td>
                  <td className="py-1.5 pr-3 font-mono">{(b.durationMs / 1000).toFixed(2)}s</td>
                  <td className="py-1.5 pr-3 font-mono text-muted-foreground">{b.promptTokens.toLocaleString()}</td>
                  <td className="py-1.5 pr-3 font-mono text-muted-foreground">{b.completionTokens.toLocaleString()}</td>
                  <td className="py-1.5">
                    <span className={b.status === 'success' ? 'text-green-700' : 'text-red-700'}>
                      {b.status}
                    </span>
                    {b.error && <span className="ml-2 text-muted-foreground" title={b.error}>⚠</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

// ─── Write Verification Panel ───────────────────────────────

function WriteVerificationPanel({ results }: { results: WriteResultRow[] }) {
  const totalDropped = results.reduce((s, r) => s + r.silentlyDropped, 0);
  const totalWritten = results.reduce((s, r) => s + r.fieldsVerifiedWritten, 0);
  const totalAttempted = results.reduce((s, r) => s + r.fieldsAttempted, 0);
  const hasIssue = totalDropped > 0 || results.some((r) => r.error);

  return (
    <section className={`rounded-lg border p-5 ${hasIssue ? 'border-orange-300 bg-orange-50/50' : 'bg-card'}`}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          {hasIssue ? '⚠ Write Verification — issues detected' : '✓ Write Verification'}
        </h3>
        <div className="text-xs text-muted-foreground">
          {totalWritten}/{totalAttempted} verified written{totalDropped > 0 ? ` · ${totalDropped} silently dropped by SF` : ''}
        </div>
      </div>

      {totalDropped > 0 && (
        <div className="mt-3 rounded border border-orange-200 bg-white p-3 text-xs">
          <p className="font-medium text-orange-900">
            {totalDropped} field{totalDropped === 1 ? '' : 's'} returned success from Salesforce but didn't actually update.
          </p>
          <p className="mt-1 text-orange-800">
            This almost always means the API user's profile doesn't have <strong>field-level security (FLS)</strong> edit
            permission on the affected <code className="font-mono">AI_*__c</code> fields. SF's REST API returns{' '}
            <code className="font-mono">204 No Content</code> in that case but silently skips the disallowed fields.
          </p>
          <p className="mt-2 text-orange-800">
            <strong>Fix:</strong> In SF Setup → Permission Sets or Profile → pick the profile used by the integration user
            → open Field-Level Security for Lead and Opportunity → grant <em>Edit</em> on every <code className="font-mono">AI_*__c</code>{' '}
            field. Then re-run the agent.
          </p>
        </div>
      )}

      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-1.5 pr-3 font-normal">Object</th>
            <th className="py-1.5 pr-3 font-normal">Record</th>
            <th className="py-1.5 pr-3 font-normal">Attempted</th>
            <th className="py-1.5 pr-3 font-normal">Verified Written</th>
            <th className="py-1.5 pr-3 font-normal">Silently Dropped</th>
            <th className="py-1.5 font-normal">Error</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={`${r.objectType}-${r.recordId}`} className="border-b last:border-0">
              <td className="py-1.5 pr-3 font-mono">{r.objectType}</td>
              <td className="py-1.5 pr-3 font-mono text-muted-foreground">{r.recordId}</td>
              <td className="py-1.5 pr-3 font-mono">{r.fieldsAttempted}</td>
              <td className="py-1.5 pr-3 font-mono text-green-700">{r.fieldsVerifiedWritten}</td>
              <td className={`py-1.5 pr-3 font-mono ${r.silentlyDropped > 0 ? 'text-orange-700 font-medium' : 'text-muted-foreground'}`}>
                {r.silentlyDropped}
              </td>
              <td className="py-1.5 text-red-700">{r.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ─── Context Found Panel ────────────────────────────────────

function ContextFoundPanel({ items }: { items: FetchInventoryRow[] }) {
  const totalItems = items.reduce((s, i) => s + i.count, 0);
  const sourcesWithData = items.filter((i) => i.status === 'ok').length;
  const errors = items.filter((i) => i.status === 'error').length;

  return (
    <section className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Context Found</h3>
        <div className="text-xs text-muted-foreground">
          {sourcesWithData}/{items.length} sources returned data · {totalItems.toLocaleString()} items total
          {errors > 0 && <span className="ml-2 text-destructive">· {errors} error{errors === 1 ? '' : 's'}</span>}
        </div>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        What each data source contributed during the fetch phase. Use this to see if the LLM had enough context
        to extract fields — e.g. if Gong Transcripts shows 0, fields that rely on call data will likely come back null.
      </p>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-normal">Source</th>
            <th className="py-2 pr-3 font-normal">Status</th>
            <th className="py-2 pr-3 font-normal">Count</th>
            <th className="py-2 font-normal">Notes</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.source} className="border-b last:border-0">
              <td className="py-1.5 pr-3">{item.source}</td>
              <td className="py-1.5 pr-3">
                <FetchStatusBadge status={item.status} />
              </td>
              <td className="py-1.5 pr-3 font-mono">
                {item.count > 0 ? item.count.toLocaleString() : <span className="text-muted-foreground">0</span>}
              </td>
              <td className="py-1.5 text-xs text-muted-foreground max-w-[400px] truncate" title={item.error ?? ''}>
                {item.error ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function FetchStatusBadge({ status }: { status: 'ok' | 'empty' | 'error' }) {
  switch (status) {
    case 'ok':
      return <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">ok</span>;
    case 'empty':
      return <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">empty</span>;
    case 'error':
      return <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">error</span>;
  }
}
