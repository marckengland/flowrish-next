'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { followUpHeaders, type FollowUpContext } from '@/lib/follow-up-access'
import { followUpAccessLost, followUpData } from '@/lib/follow-up-client'
import { taskHistoryData, type TaskHistoryData } from '@/lib/follow-up-task-history'
type Props = { id: string; taskId: string; context: FollowUpContext; revision: string; onAccessLost: (cause: unknown, id: string) => void }
export function FollowUpTaskHistory(props: Props) { return <TaskHistory key={JSON.stringify([props.context.organizationId, props.context.userId, props.id, props.taskId])} {...props} /> }
function TaskHistory({ id, taskId, context, revision, onAccessLost }: Props) {
 const { organizationId, userId } = context, regionId = useId()
 const [open, setOpen] = useState(false), [data, setData] = useState<TaskHistoryData | null>(null), [page, setPage] = useState(1), [busy, setBusy] = useState(false), [error, setError] = useState(''), [zone, setZone] = useState('UTC')
 const live = useRef(true), controller = useRef<AbortController | null>(null), blocked = useRef(false), failed = useRef(false)
 useEffect(() => { try { const detected = Intl.DateTimeFormat().resolvedOptions().timeZone; new Intl.DateTimeFormat('en', { timeZone: detected }).format(); setZone(detected) } catch { setZone('UTC') } }, [])
 const cancel = useCallback(() => { controller.current?.abort(); controller.current = null }, [])
 const load = useCallback(async (nextPage: number) => {
  if (!live.current || blocked.current) return
  failed.current = false; cancel(); const request = new AbortController(); controller.current = request; setBusy(true); setData(null); setError('')
  const active = () => live.current && !request.signal.aborted && controller.current === request
  try {
   const captured = { organizationId, userId }, response = await fetch('/api/follow-ups/' + encodeURIComponent(id) + '/task-history?page=' + nextPage, { method: 'GET', cache: 'no-store', headers: followUpHeaders(captured), signal: request.signal })
   const parsed = taskHistoryData.safeParse((await followUpData(response, captured)).data)
   if (!parsed.success || parsed.data.id !== id || parsed.data.taskId !== taskId || parsed.data.page !== nextPage || new Set(parsed.data.entries.map(row => row.id)).size !== parsed.data.entries.length) throw new Error('Task activity could not be verified. Refresh to try again.')
   if (active()) { setData(parsed.data); setPage(nextPage) }
  } catch (cause) {
   if (!active()) return
   if (followUpAccessLost(cause)) { blocked.current = true; setData(null); onAccessLost(cause, id); return }
   failed.current = true
   setError(cause instanceof Error ? cause.message : 'Task activity is unavailable. Refresh to try again.')
  } finally { if (active()) { controller.current = null; setBusy(false) } }
 }, [cancel, id, taskId, organizationId, userId, onAccessLost])
 useEffect(() => { live.current = true; return () => { live.current = false; cancel() } }, [cancel])
 useEffect(() => { if (open) void load(1); return cancel }, [open, revision, load, cancel])
 useEffect(() => {
  if (!open || error) return
  const refresh = () => { if (document.visibilityState === 'visible' && !controller.current && !failed.current) void load(page) }
  const timer = window.setInterval(refresh, 60000); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
  return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
 }, [open, page, error, load])
 const dateLabel = (value: string) => new Intl.DateTimeFormat(undefined, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
 return <div className="mt-4">
  <Button type="button" variant="outline" aria-expanded={open} aria-controls={regionId} onClick={() => { cancel(); setData(null); setError(''); setBusy(false); setOpen(value => !value) }}>{open ? 'Hide task activity' : 'View task activity'}</Button>
  {open && <section id={regionId} aria-label="Task activity" aria-busy={busy} className="mt-3 space-y-3 rounded-lg border p-3">
   <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Recorded task activity</h3><Button type="button" variant="outline" disabled={busy || blocked.current} onClick={() => void load(1)}>Refresh task activity</Button></div>
   <p className="text-xs text-muted-foreground">Recorded inbox task completion and deadline changes, newest first. Earlier CRM actions and unsupported records are not reconstructed. Viewing activity does not change work.</p>
   <p className="text-xs text-muted-foreground">Times shown in {zone}. Event times are when actions were recorded.</p>
   {busy && <p role="status" className="text-sm">Loading task activity…</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
   {data && <><p className="text-xs text-muted-foreground">Checked <time dateTime={data.checkedAt}>{dateLabel(data.checkedAt)}</time> · {zone}</p>
    {data.entries.length ? <ol aria-label="Recorded task events" className="divide-y">{data.entries.map(row => <li key={row.id} className="space-y-1 break-words py-3 text-sm">
     <p><span className="font-medium">{row.actor}</span> · <span>{row.kind === 'completed' ? 'Task completed' : 'Task rescheduled'}</span></p>
     <p className="text-xs text-muted-foreground">Recorded <time dateTime={row.occurredAt}>{dateLabel(row.occurredAt)}</time> · {zone}</p>
     {row.kind === 'rescheduled' && <><p>Old deadline: <time dateTime={row.previousDueDate}>{dateLabel(row.previousDueDate)}</time> · {zone}</p><p>New deadline: <time dateTime={row.dueDate}>{dateLabel(row.dueDate)}</time> · {zone}</p></>}
    </li>)}</ol> : <p className="text-sm text-muted-foreground">No supported task events on this page.</p>}
    <div className="flex flex-wrap items-center gap-2"><p className="text-xs text-muted-foreground">Task activity · Page {data.page}</p><Button type="button" variant="outline" disabled={busy || page === 1} onClick={() => void load(page - 1)}>Newer task activity</Button><Button type="button" variant="outline" disabled={busy || !data.hasMore || page >= 10000} onClick={() => void load(page + 1)}>Older task activity</Button></div>
   </>}
  </section>}
 </div>
}
