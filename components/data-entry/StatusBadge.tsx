'use client';

/**
 * Per-status visual treatment. Covers the full runs.run_status enum (running,
 * completed, failed, sleeping, awaiting_approval, awaiting_reply,
 * awaiting_subagents, cancelled) AND the runs.dispatch_queue statuses
 * (pending, dispatching, dispatched, dead) the UI surfaces. `pulse` marks an
 * in-flight state; `label` is the human-facing text so a badge NEVER renders
 * raw snake_case.
 */
type StatusStyle = { className: string; label: string; pulse?: 'blue' | 'amber' };

const STATUS_STYLES: Record<string, StatusStyle> = {
  // ── Run lifecycle ──
  running: { className: 'bg-blue-100 text-blue-800', label: 'Running', pulse: 'blue' },
  completed: { className: 'bg-green-100 text-green-800', label: 'Completed' },
  failed: { className: 'bg-red-100 text-red-800', label: 'Failed' },
  cancelled: { className: 'bg-gray-100 text-gray-800', label: 'Cancelled' },
  // Lead/Opp runs sleep ~2h after trigger; the dominant in-flight state.
  sleeping: { className: 'bg-amber-100 text-amber-800', label: 'Waiting', pulse: 'amber' },
  awaiting_reply: { className: 'bg-amber-100 text-amber-800', label: 'Awaiting transcript', pulse: 'amber' },
  awaiting_subagents: { className: 'bg-amber-100 text-amber-800', label: 'Awaiting sub-agents', pulse: 'amber' },
  awaiting_approval: { className: 'bg-blue-100 text-blue-800', label: 'Awaiting approval', pulse: 'blue' },
  // ── Dispatch queue ──
  pending: { className: 'bg-gray-100 text-gray-800', label: 'Pending' },
  dispatching: { className: 'bg-blue-100 text-blue-800', label: 'Dispatching', pulse: 'blue' },
  dispatched: { className: 'bg-green-100 text-green-800', label: 'Dispatched' },
  dead: { className: 'bg-red-100 text-red-800', label: 'Dead' },
  // ── Legacy/alias statuses kept for compatibility ──
  waiting: { className: 'bg-amber-100 text-amber-800', label: 'Waiting', pulse: 'amber' },
  processing: { className: 'bg-blue-100 text-blue-800', label: 'Processing', pulse: 'blue' },
};

/** Humanize any unmapped status so the badge never shows raw snake_case. */
function humanizeStatus(status: string): string {
  if (!status) return 'Unknown';
  return status
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_STYLES[status];
  const className = entry?.className ?? 'bg-gray-100 text-gray-800';
  const label = entry?.label ?? humanizeStatus(status);
  const pulse = entry?.pulse;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {pulse === 'blue' && (
        <span aria-hidden="true" className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
      )}
      {pulse === 'amber' && (
        <span aria-hidden="true" className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600" />
      )}
      {label}
    </span>
  );
}

export function WriteStatusBadge({ wasWritten, skipReason, hasErrors }: {
  wasWritten: boolean;
  skipReason: string | null;
  hasErrors: boolean;
}) {
  if (skipReason === 'sf_rejected') {
    return (
      <span
        title="Salesforce explicitly rejected this field value (e.g. bad picklist value, validation rule, record-type restriction)."
        className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
      >
        SF rejected
      </span>
    );
  }
  if (skipReason === 'write_silently_dropped') {
    return (
      <span
        title="Salesforce returned success but the field value didn't change — usually a field-level-security restriction on the API user."
        className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800"
      >
        SF dropped
      </span>
    );
  }
  if (skipReason === 'write_failed') {
    return <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">write failed</span>;
  }
  if (hasErrors) {
    return <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">error</span>;
  }
  if (wasWritten) {
    return <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">written</span>;
  }
  if (skipReason === 'dry_run') {
    return <span className="inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">dry run</span>;
  }
  return <span className="inline-flex rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800">skipped</span>;
}

export function DryRunBadge() {
  return (
    <span className="inline-flex rounded-full border border-sky-300 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
      DRY RUN
    </span>
  );
}
