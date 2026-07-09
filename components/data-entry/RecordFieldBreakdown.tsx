'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import { WriteStatusBadge } from './StatusBadge';
import type { RecordFieldRow, RecordFieldsResponse } from './analytics/types';

/** "bant_authority" -> "Bant Authority". Same transform StatusBadge.tsx uses for statuses. */
function humanizeGroup(group: string | null): string {
  if (!group) return '—';
  return group.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function RecordFieldBreakdown({ recordId }: { recordId: string }) {
  const [data, setData] = useState<RecordFieldsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch(`/record-fields?recordId=${encodeURIComponent(recordId)}`)
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as Partial<RecordFieldsResponse> & {
          error?: string;
        };
        if (!r.ok) throw new Error(body.error ?? `Failed to load (${r.status})`);
        return body as RecordFieldsResponse;
      })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, [recordId]);

  if (loading) return <div className="h-32 animate-pulse rounded-xl border bg-card" />;
  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!data || !data.run_id) return null; // no runs yet — SearchByRecordId already shows that state

  const problems = data.fields.filter(
    (f) => f.write_outcome !== 'written' && f.write_outcome !== 'dry_run',
  );
  const visible: RecordFieldRow[] = showAll ? data.fields : problems;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Field Breakdown ({problems.length} of {data.fields.length} not written)
        </p>
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="text-xs text-muted-foreground hover:underline"
        >
          {showAll ? 'Show only problems' : `Show all ${data.fields.length} fields`}
        </button>
      </div>
      <div className="space-y-1">
        {visible.map((f) => (
          <div key={f.field_key} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-xs">
            <span className="w-48 truncate font-mono">{f.field_name}</span>
            <span className="w-32 text-muted-foreground">{humanizeGroup(f.group_key)}</span>
            <WriteStatusBadge
              wasWritten={f.was_written}
              skipReason={f.skip_reason}
              hasErrors={(f.validation_errors ?? []).length > 0}
            />
            <span className="flex-1 truncate text-muted-foreground" title={f.evidence ?? undefined}>
              {f.skip_reason ?? f.write_outcome ?? (f.was_written ? f.extracted_value : '—')}
            </span>
          </div>
        ))}
        {visible.length === 0 && (
          <p className="py-4 text-center text-xs text-muted-foreground">Every field wrote successfully.</p>
        )}
      </div>
    </div>
  );
}
