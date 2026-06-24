import { apiFetch } from '@/lib/api/client';
import RunDetailView from '@/components/data-entry/RunDetailView';

export const dynamic = 'force-dynamic';

/**
 * Run detail page.
 *
 * Previously this server component queried revops-db directly (createServiceClient)
 * and shaped the RunDetail (run + extractions + batchSummary) in-process. That
 * data access now lives in the revops-agents Lambda, which serves GET /runs/<id>
 * and returns the SAME bundle this page used to build: `{ run, extractions,
 * batchSummary }` (the mapRun shape — extended with write_results / batch_id /
 * fetch_* etc. — plus the mapped extraction rows and the per-group summary).
 * A missing run yields a 404, rendered here as the same "Run not found" panel.
 * The RunDetailView markup/props are unchanged.
 */
export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const res = await apiFetch(`/runs/${encodeURIComponent(id)}`, {
    // Always reflect current run state — never serve a cached run detail.
    cache: 'no-store',
  });

  if (!res.ok) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Run not found.</p>
      </div>
    );
  }

  const data = await res.json().catch(() => null);
  if (!data || !data.run) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Run not found.</p>
      </div>
    );
  }

  const { run, extractions, batchSummary } = data as {
    run: unknown;
    extractions: unknown[];
    batchSummary: Record<string, { total: number; written: number; skipped: number; errored: number }>;
  };

  return (
    <RunDetailView
      run={run as never}
      extractions={(extractions ?? []) as never[]}
      batchSummary={batchSummary ?? {}}
    />
  );
}
