import SearchByRecordId from '@/components/data-entry/SearchByRecordId';

export const dynamic = 'force-dynamic';

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ recordId?: string }>;
}) {
  const { recordId } = await searchParams;
  return <SearchByRecordId initialRecordId={recordId ?? ''} />;
}
