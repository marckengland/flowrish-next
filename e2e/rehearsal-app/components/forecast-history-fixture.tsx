'use client'
import { useQuery } from '@tanstack/react-query'
import { ForecastHistory } from '@/components/forecast/forecast-history'
import { WorkspaceBoundary } from '@/components/layout/workspace-boundary'
import type { ForecastHistoryReport } from '@/lib/forecast-basis'
export function ForecastHistoryFixture() {
  return <WorkspaceBoundary organizationId="99999999-9999-4999-8999-999999999999"><Contents /></WorkspaceBoundary>
}
function Contents() {
  const query = useQuery<ForecastHistoryReport>({ queryKey: ['forecast-history', '99999999-9999-4999-8999-999999999999'], retry: false, staleTime: 0, queryFn: async () => {
    const response = await fetch('/api/forecast/history')
    if (!response.ok) throw new Error('Synthetic history unavailable')
    return (await response.json()).data
  } })
  return <div className="min-w-0 space-y-4"><h1 className="text-2xl font-semibold">Forecast history</h1><ForecastHistory report={query.data ?? null} error={query.isError} /></div>
}
