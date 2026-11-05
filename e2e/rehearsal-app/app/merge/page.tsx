import { DuplicateCheck } from '@/components/leads/duplicate-check'
import { coreIds } from '../../core-fixtures'
export default async function Page({ searchParams }: { searchParams: Promise<{ readonly?: string }> }) {
  const query = await searchParams
  return <div className="mx-auto max-w-4xl space-y-4"><h1 className="text-xl font-semibold">Practice lead merge</h1><DuplicateCheck leadId={coreIds.lead} organizationId={coreIds.organization} userId={coreIds.user} canMerge={query.readonly !== 'true'} /></div>
}
