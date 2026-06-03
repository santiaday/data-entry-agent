'use client';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  waiting: 'bg-amber-100 text-amber-800',
  processing: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

export function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-800';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${style}`}>
      {status === 'running' && (
        <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
      )}
      {(status === 'waiting' || status === 'processing') && (
        <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-amber-600" />
      )}
      {status}
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
