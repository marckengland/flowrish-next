'use client'
import { useState } from 'react'
import { LeadFilters, type LeadFiltersProps } from './lead-filters'
import { SavedLeadViews } from './saved-lead-views'

export function LeadViewControls(props: LeadFiltersProps & { organizationId: string; userId: string; pipelineId: string }) {
  return <ScopedControls key={`${props.organizationId}:${props.userId}`} {...props} />
}
function ScopedControls({ organizationId, userId, pipelineId, stages = [], assignees = [] }: LeadFiltersProps & { organizationId: string; userId: string; pipelineId: string }) {
  const [filtersReady, setFiltersReady] = useState(false)
  return <><SavedLeadViews organizationId={organizationId} userId={userId} pipelineId={pipelineId} stages={stages} assignees={assignees} filtersReady={filtersReady} /><LeadFilters stages={stages} assignees={assignees} storageKey={`flowrish:leads:filters:${organizationId}:${userId}`} onReadyChange={setFiltersReady} /></>
}
