'use client'

import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { faqDraftInputSchema, faqDraftResultSchema, type FaqDraftResult } from '@/lib/rehearsal-faq'

export function RehearsalFaqAction({ rehearsalId, messageIndex, expectedUpdatedAt, disabled }: {
  rehearsalId: string
  messageIndex: number
  expectedUpdatedAt: string
  disabled: boolean
}): React.JSX.Element {
  const [result, setResult] = useState<FaqDraftResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    request.current?.abort()
    request.current = null
    setResult(null)
    setBusy(false)
    setError('')
    return () => { request.current?.abort() }
  }, [rehearsalId, messageIndex, expectedUpdatedAt, disabled])

  async function create(): Promise<void> {
    if (disabled || request.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const input = faqDraftInputSchema.parse({ messageIndex, expectedUpdatedAt })
      z.string().uuid().parse(rehearsalId)
      const response = await fetch(`/api/admin/receptionist/rehearsals/${rehearsalId}/faq`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
      })
      if (controller.signal.aborted || request.current !== controller) return
      if (response.status === 409) {
        setError('This saved review changed. Reload the latest rehearsal and review its saved knowledge gaps before trying again.')
        return
      }
      if (response.status === 400) {
        const body = await response.json()
        if (body?.error?.code === 'KNOWLEDGE_LIMIT') {
          if (!controller.signal.aborted && request.current === controller) setError('The knowledge library is full. Archive a document before creating another FAQ draft.')
          return
        }
      }
      if (!response.ok) throw new Error('Request failed')
      const next = faqDraftResultSchema.parse((await response.json())?.data)
      if (!controller.signal.aborted && request.current === controller) setResult(next)
    } catch {
      if (!controller.signal.aborted && request.current === controller) setError('Could not open an FAQ draft. Please try again.')
    } finally {
      if (!controller.signal.aborted && request.current === controller) { setBusy(false); request.current = null }
    }
  }

  return <div className="space-y-2">
    {result ? <>
      <a href={result.knowledgeUrl} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Open FAQ draft</a>
      <p className="text-sm text-muted-foreground">Write the answer and review it in the knowledge library. Publish it and approve it for the receptionist explicitly when ready.</p>
    </> : <Button type="button" variant="outline" className="min-h-11" disabled={disabled || busy} onClick={() => void create()}>{busy ? 'Creating FAQ draft…' : 'Create FAQ draft'}</Button>}
    {busy && <p role="status" className="sr-only">Creating FAQ draft…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>
}
