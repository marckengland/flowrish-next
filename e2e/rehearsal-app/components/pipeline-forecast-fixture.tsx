'use client'
import Link from 'next/link'
import { useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { KanbanBoard } from '@/components/pipeline/kanban-board'
import { ForecastPanel } from '@/components/forecast/forecast-panel'
import { CommitForm } from '@/components/forecast/commit-form'
import { RiskIndicator } from '@/components/forecast/risk-indicator'
import { WorkspaceBoundary } from '@/components/layout/workspace-boundary'
import { pipelineIds, pipelineStages, pipelineLeads } from '../pipeline-fixtures'
export function PipelineFixture({ readOnly, empty }: { readOnly: boolean; empty: boolean }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 0, retry: false }, mutations: { retry: false } } }))
  const leads = empty ? [] : pipelineLeads()
  return <QueryClientProvider client={client}><WorkspaceBoundary organizationId="99999999-9999-4999-8999-999999999999"><div className="min-w-0 space-y-4">
    <h1 className="text-2xl font-semibold">Sales Pipeline</h1>
    <Link className="underline" href={readOnly ? '/forecast?readonly=1' : '/forecast'}>Forecast</Link>
    <KanbanBoard stages={pipelineStages} initialLeads={leads} totalLeads={leads.length} canMove={!readOnly} pipelineId={pipelineIds.pipeline} />
  </div></WorkspaceBoundary></QueryClientProvider>
}
async function data(path: string) {
  const response = await fetch(path)
  if (!response.ok) throw new Error('Synthetic forecast unavailable')
  return (await response.json()).data
}
export function ForecastFixture({ readOnly }: { readOnly: boolean }) {
  return <WorkspaceBoundary organizationId="99999999-9999-4999-8999-999999999999"><ForecastContents readOnly={readOnly} /></WorkspaceBoundary>
}
function ForecastContents({ readOnly }: { readOnly: boolean }) {
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['pipeline-audit-forecast'], queryFn: async () => ({ metrics: await data('/api/forecast'), comparison: await data('/api/forecast/compare') }), retry: false, staleTime: 0 })
  if (query.isError) return <div><h1>Forecast</h1><p role="alert">Forecast is not available.</p><Link href="/pipeline">Pipeline</Link></div>
  if (!query.data) return <p role="status">Loading forecast…</p>
  const { metrics, comparison } = query.data
  return <div className="min-w-0 space-y-4">
    <h1 className="text-2xl font-semibold">Forecast</h1>
    <Link className="underline" href="/pipeline">Pipeline</Link>
    <section aria-label="Pipeline metrics"><ForecastPanel {...metrics} /></section>
    <CommitForm defaultPeriod="2026-11" defaultCommitAmount={comparison.latestSubmission ? Number(comparison.latestSubmission.commitAmount) : null} defaultNotes={comparison.latestSubmission?.notes} canSubmit={!readOnly} onSuccess={() => { void client.invalidateQueries({ queryKey: ['pipeline-audit-forecast'] }) }} />
    {comparison.latestSubmission ? <RiskIndicator risk={comparison.riskLevel} context="2026-11" /> : <p>No commit submitted for 2026-11</p>}
  </div>
}
