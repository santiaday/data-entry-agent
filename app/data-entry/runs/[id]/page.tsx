import { createServiceClient } from '@/lib/supabase/server';
import { mapRun, mapExtraction, extractionCounts } from '@/lib/revops/mappers';
import RunDetailView from '@/components/data-entry/RunDetailView';

export const dynamic = 'force-dynamic';

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = createServiceClient();

  const [runRes, extractionsRes] = await Promise.all([
    supabase.from('runs.agent_runs').select('*').eq('run_id', id).maybeSingle(),
    supabase
      .from('runs.field_extractions')
      .select('*')
      .eq('run_id', id)
      .order('group_key', { ascending: true })
      .order('field_api_name', { ascending: true }),
  ]);

  if (!runRes.data) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Run not found.</p>
      </div>
    );
  }

  const rawExtractions = (extractionsRes.data ?? []) as Record<string, unknown>[];
  const extractions = rawExtractions.map((r) => mapExtraction(r));
  const counts = extractionCounts(rawExtractions as Array<{ write_outcome?: string | null }>);

  // Per-group summary for the batch filter/summary in the view.
  const batchSummary: Record<string, { total: number; written: number; skipped: number; errored: number }> = {};
  for (const ext of extractions) {
    const key = ext.batch_id || '(none)';
    if (!batchSummary[key]) batchSummary[key] = { total: 0, written: 0, skipped: 0, errored: 0 };
    batchSummary[key].total++;
    if (ext.was_written) batchSummary[key].written++;
    else if (ext.validation_errors && ext.validation_errors.length > 0) batchSummary[key].errored++;
    else if (ext.skip_reason) batchSummary[key].skipped++;
  }

  // Write-verification panel: roll up per Salesforce object (the FLS-drop signal
  // surfaced by sf.write — the most valuable panel for this agent).
  const byObject = new Map<string, { recordId: string; attempted: number; written: number; dropped: number }>();
  for (const ext of extractions) {
    if (ext.write_outcome === 'dry_run' || ext.write_outcome === 'skipped_no_value') continue;
    const o = byObject.get(ext.sf_object) ?? { recordId: '', attempted: 0, written: 0, dropped: 0 };
    o.attempted++;
    if (ext.was_written) o.written++;
    else if (ext.write_outcome === 'write_silently_dropped') o.dropped++;
    byObject.set(ext.sf_object, o);
  }
  const writeResults = [...byObject.entries()].map(([objectType, c]) => ({
    objectType,
    recordId: c.recordId,
    fieldsAttempted: c.attempted,
    fieldsVerifiedWritten: c.written,
    silentlyDropped: c.dropped,
    error: c.dropped > 0 ? `${c.dropped} field(s) silently dropped — likely FLS on the integration user` : null,
  }));

  const run = {
    ...mapRun(runRes.data as Record<string, unknown>, counts),
    batch_id: '',
    fetch_errors: [],
    batch_errors: [],
    write_results: writeResults,
    fetch_inventory: [],
    phase_timings: [],
    batch_executions: [],
    total_prompt_tokens: null,
    total_completion_tokens: null,
  };

  return (
    <RunDetailView run={run as never} extractions={extractions as never[]} batchSummary={batchSummary} />
  );
}
