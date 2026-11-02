'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { faqOriginSchema, type FaqOrigin } from '@/lib/rehearsal-faq'

export function KnowledgeRehearsalOrigin({ documentId, autoLoad = false, disabled = false, hasUnsavedChanges = false }: {
  documentId: string
  autoLoad?: boolean
  disabled?: boolean
  hasUnsavedChanges?: boolean
}): React.JSX.Element {
  const [origin, setOrigin] = useState<FaqOrigin | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)

  const load = useCallback(async (): Promise<void> => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      z.string().uuid().parse(documentId)
      const response = await fetch(`/api/knowledge/${documentId}/rehearsal`, { method: 'GET', cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('Request failed')
      const next = faqOriginSchema.nullable().parse((await response.json())?.data)
      if (!controller.signal.aborted && request.current === controller) setOrigin(next)
    } catch {
      if (!controller.signal.aborted && request.current === controller) setError('Could not load the rehearsal source. Please try again.')
    } finally {
      if (!controller.signal.aborted && request.current === controller) { setBusy(false); request.current = null }
    }
  }, [documentId])

  useEffect(() => {
    request.current?.abort()
    request.current = null
    setOrigin(undefined)
    setError('')
    setBusy(false)
    if (autoLoad) void load()
    return () => { request.current?.abort() }
  }, [autoLoad, load])

  return <section aria-label="Rehearsal source" className="mt-4 space-y-2 rounded-lg border p-3 text-sm">
    {origin === undefined && <Button type="button" variant="outline" className="min-h-11" disabled={disabled || busy} onClick={() => void load()}>View rehearsal source</Button>}
    {busy && <p role="status" className="text-muted-foreground">Loading rehearsal source…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {origin === null && <p className="text-muted-foreground">No saved rehearsal source is available for this document. It may have been created separately or its report was deleted.</p>}
    {origin && <>
      <p className="text-muted-foreground">Internal source: caller message {origin.messageIndex + 1}. This source is separate from the published document text.</p>
      {disabled || hasUnsavedChanges ? <Button type="button" variant="outline" className="min-h-11 h-auto whitespace-normal text-left" disabled>Open rehearsal: {origin.title}</Button> : <a href={origin.rehearsalUrl} className="inline-flex min-h-11 items-center break-words underline underline-offset-4">Open rehearsal: {origin.title}</a>}
      {hasUnsavedChanges && <p className="text-muted-foreground">Save draft before opening the rehearsal source. Your edits are still here.</p>}
      <p className="text-muted-foreground">After publishing and approving the answer, open the rehearsal and choose Start browser preview to retest manually.</p>
    </>}
  </section>
}
