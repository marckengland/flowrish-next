'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ReceptionistChecklist } from '@/lib/receptionist-checklist'

export function ReceptionistReadinessChecklist({ hasUnsavedChanges }: { hasUnsavedChanges: boolean }): React.JSX.Element {
  const [checklist, setChecklist] = useState<ReceptionistChecklist | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const titleId = useId()
  const helpId = useId()

  useEffect(() => {
    setChecklist(null)
    setLoading(false)
    setError('')
    return () => { request.current?.abort() }
  }, [hasUnsavedChanges])

  async function check() {
    if (hasUnsavedChanges || loading) return
    const controller = new AbortController()
    request.current?.abort()
    request.current = controller
    setLoading(true)
    setChecklist(null)
    setError('')
    try {
      const response = await fetch('/api/admin/receptionist/checklist', {
        method: 'GET', cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) throw new Error('Checklist unavailable')
      const body = await response.json()
      const next = body?.data as ReceptionistChecklist | undefined
      if (next?.scope !== 'saved_setup' || !Array.isArray(next.checks) || next.checks.length !== 5 ||
        next.checks.some((item) => !item || typeof item.label !== 'string' || typeof item.detail !== 'string' ||
          (item.status !== 'complete' && item.status !== 'attention'))) {
        throw new Error('Invalid checklist')
      }
      if (!controller.signal.aborted) setChecklist(next)
    } catch {
      if (!controller.signal.aborted) setError('Could not check saved setup. Please try again.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const complete = checklist?.checks.filter((item) => item.status === 'complete').length ?? 0

  return (
    <Card aria-labelledby={titleId}>
      <CardHeader className="flex-col items-start gap-2">
        <CardTitle id={titleId}>Saved setup checklist</CardTitle>
        <p className="text-sm text-muted-foreground">Checks saved setup presence only. This does not verify business facts, live AI answers, billing, or phone routing.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasUnsavedChanges && <p id={helpId} className="text-sm text-muted-foreground">Save your receptionist settings before checking readiness.</p>}
        <Button type="button" variant="outline" className="min-h-11" disabled={hasUnsavedChanges || loading} aria-describedby={hasUnsavedChanges ? helpId : undefined} onClick={() => { void check() }}>
          {loading && <Loader2 className="mr-2 size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {loading ? 'Checking…' : 'Check readiness'}
        </Button>
        <p role={loading || checklist ? 'status' : undefined} className="text-sm font-medium">
          {loading ? 'Checking saved setup…' : checklist ? `${complete} of ${checklist.checks.length} saved setup checks complete` : 'Saved setup has not been checked.'}
        </p>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {checklist && <ul aria-label="Saved setup checks" className="space-y-4">
          {checklist.checks.map((item) => (
            <li key={item.id} className="flex items-start gap-3 text-sm">
              {item.status === 'complete' ? <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}
              <div className="min-w-0 space-y-1 break-words">
                <p className="font-medium">{item.label} · <span className="font-normal">{item.status === 'complete' ? 'Complete' : 'Needs attention'}</span></p>
                <p className="text-muted-foreground">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>}
        <p className="text-xs text-muted-foreground">AI and phone connections remain unverified. Checking this list does not contact an AI provider, connect a number, or enable reception.</p>
      </CardContent>
    </Card>
  )
}
