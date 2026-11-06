'use client'
import { useId } from 'react'
export type FollowUpBulkAction = 'snooze' | 'approve' | 'complete' | 'reschedule'
const labels: Record<FollowUpBulkAction,string> = { snooze:'Snooze follow-ups', approve:'Approve tasks', complete:'Complete tasks', reschedule:'Reschedule deadlines' }
type Props = { action: FollowUpBulkAction | ''; available: FollowUpBulkAction[]; selectedCount: number; retained: boolean; disabled: boolean; onChange: (action: FollowUpBulkAction | '') => void }
export function FollowUpBulkActions({ action, available, selectedCount, retained, disabled, onChange }: Props) {
 const id = useId()
 return <section aria-label="Bulk actions" className="min-w-0 space-y-2 rounded-lg border bg-card p-4">
  <div className="flex flex-col gap-3 sm:flex-row sm:items-end"><label htmlFor={id} className="grid min-w-0 flex-1 gap-1.5 text-sm font-medium">Bulk actions<select id={id} value={action} disabled={disabled} className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onChange={event => { const value=event.target.value; if(value==='' || available.includes(value as FollowUpBulkAction))onChange(value as FollowUpBulkAction|'') }}><option value="">Choose an action</option>{available.map(value=><option key={value} value={value}>{labels[value]}</option>)}</select></label><p className="pb-2 text-sm text-muted-foreground">{action ? `${selectedCount} selected` : 'Select an action to get started.'}</p></div>
  {retained && <p className="text-xs text-muted-foreground">Active reviews, edits and results stay open until you clear or cancel them. Switching this menu keeps your work.</p>}
 </section>
}
