import BatchDetailView from '@/components/data-entry/BatchDetailView';

export const dynamic = 'force-dynamic';

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BatchDetailView batchId={id} />;
}
