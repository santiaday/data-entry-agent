'use client';

import { useState } from 'react';
import Link from 'next/link';
import { StatusBadge, WriteStatusBadge, DryRunBadge } from './StatusBadge';
import { StatCard } from './StatCard';
import { ConfidenceBar } from './ConfidenceBar';
import type { RunListItem, ExtractionRow, WriteResultRow } from './types';

type RunDetail = RunListItem & {
  write_results: WriteResultRow[] | null;
};

/** write_outcome values that count as a genuine error (matches extractionCounts). */
const ERROR_OUTCOMES = new Set([
  'invalid',
  'sf_rejected',
  'write_silently_dropped',
  'write_failed',
]);

function isErrorRow(e: ExtractionRow): boolean {
  return ERROR_OUTCOMES.has(e.write_outcome ?? '') || (e.validation_errors ?? []).length > 0;
}

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

  // Filter extractions — 'error'/'skipped' classification follows the
  // write_outcome taxonomy so the table agrees with the headline counts.
  const filtered = extractions.filter((e) => {
    if (filterBatch !== 'all' && e.batch_id !== filterBatch) return false;
    if (filterStatus === 'written' && !e.was_written) return false;
    if (filterStatus === 'skipped' && (e.was_written || isErrorRow(e))) return false;
    if (filterStatus === 'error' && !isErrorRow(e)) return false;
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
            {run.object_type}
            {run.record_id && <span className="ml-1 font-mono">{run.record_id}</span>}
            {run.duration_ms ? ` — ${(run.duration_ms / 1000).toFixed(1)}s` : ''}
          </p>
        </div>
        {run.record_id && (
          <div className="flex items-center gap-3 text-sm">
            <Link
              href={`/data-entry/search?recordId=${encodeURIComponent(run.record_id)}`}
              className="text-muted-foreground hover:text-foreground transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 rounded"
            >
              All runs for this record
            </Link>
          </div>
        )}
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
              <pre className="mt-3 overflow-x-auto rounded border border-destructive/20 bg-card p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
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

      {/* ── Write Verification ────────────────────────── */}
      {run.write_results && run.write_results.length > 0 && (
        <WriteVerificationPanel results={run.write_results} />
      )}

      {/* ── Filters ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Batch</label>
          <select
            value={filterBatch}
            onChange={(e) => setFilterBatch(e.target.value)}
            className="rounded-lg border bg-background px-2 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
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
            className="rounded-lg border bg-background px-2 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
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
        className={`border-b last:border-0 cursor-pointer hover:bg-accent/50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-200 ${rowBg}`}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
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

// ─── Write Verification Panel ───────────────────────────────

function WriteVerificationPanel({ results }: { results: WriteResultRow[] }) {
  const totalDropped = results.reduce((s, r) => s + r.silentlyDropped, 0);
  const totalWritten = results.reduce((s, r) => s + r.fieldsVerifiedWritten, 0);
  const totalAttempted = results.reduce((s, r) => s + r.fieldsAttempted, 0);
  const hasIssue = totalDropped > 0 || results.some((r) => r.error);

  return (
    <section className={`rounded-xl border p-5 ${hasIssue ? 'border-orange-300 bg-orange-50/50' : 'bg-card'}`}>
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {hasIssue ? (
            <svg aria-hidden="true" className="h-4 w-4 text-orange-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
          ) : (
            <svg aria-hidden="true" className="h-4 w-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          )}
          {hasIssue ? 'Write Verification — issues detected' : 'Write Verification'}
        </h3>
        <div className="text-xs text-muted-foreground">
          {totalWritten}/{totalAttempted} verified written{totalDropped > 0 ? ` · ${totalDropped} silently dropped by SF` : ''}
        </div>
      </div>

      {totalDropped > 0 && (
        <div className="mt-3 rounded-lg border border-orange-200 bg-card p-3 text-xs">
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
            <th className="py-1.5 pr-3 font-normal">Attempted</th>
            <th className="py-1.5 pr-3 font-normal">Verified Written</th>
            <th className="py-1.5 pr-3 font-normal">Silently Dropped</th>
            <th className="py-1.5 font-normal">Error</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => (
            <tr key={`${r.objectType}-${i}`} className="border-b last:border-0">
              <td className="py-1.5 pr-3 font-mono">{r.objectType}</td>
              <td className="py-1.5 pr-3 font-mono">{r.fieldsAttempted}</td>
              <td className="py-1.5 pr-3 font-mono text-emerald-700">{r.fieldsVerifiedWritten}</td>
              <td className={`py-1.5 pr-3 font-mono ${r.silentlyDropped > 0 ? 'text-orange-700 font-medium' : 'text-muted-foreground'}`}>
                {r.silentlyDropped}
              </td>
              <td className="py-1.5 text-destructive">{r.error ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
