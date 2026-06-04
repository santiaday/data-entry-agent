import { createServiceClient } from '@/lib/supabase/server';
import { DEFAULT_ORG_ID } from '@/lib/constants';
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
    supabase
      .from('de_runs')
      .select('*')
      .eq('id', id)
      .eq('org_id', DEFAULT_ORG_ID)
      .maybeSingle(),
    supabase
      .from('de_extractions')
      .select('*')
      .eq('run_id', id)
      .eq('org_id', DEFAULT_ORG_ID)
      .order('batch_id', { ascending: true })
      .order('field_name', { ascending: true }),
  ]);

  if (!runRes.data) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Run not found.</p>
      </div>
    );
  }

  // Attach the parent batch (originally a PostgREST embedded resource — the
  // local Postgres adapter doesn't support embeds, so fetch it separately).
  const run = runRes.data as Record<string, unknown> & { batch_id?: string | null };
  if (run.batch_id) {
    const batchRes = await supabase
      .from('de_batches')
      .select('trigger_type, soql_query, dry_run')
      .eq('id', run.batch_id)
      .maybeSingle();
    run.de_batches = batchRes.data ?? null;
  }

  // Compute batch summary
  const extractions = extractionsRes.data ?? [];
  const batchSummary: Record<string, { total: number; written: number; skipped: number; errored: number }> = {};

  for (const ext of extractions) {
    const key = ext.batch_id as string;
    if (!batchSummary[key]) {
      batchSummary[key] = { total: 0, written: 0, skipped: 0, errored: 0 };
    }
    batchSummary[key].total++;
    if (ext.was_written) batchSummary[key].written++;
    else if (ext.validation_errors && ext.validation_errors.length > 0) batchSummary[key].errored++;
    else if (ext.skip_reason) batchSummary[key].skipped++;
  }

  return (
    <RunDetailView
      run={run as never}
      extractions={extractions as never[]}
      batchSummary={batchSummary}
    />
  );
}
