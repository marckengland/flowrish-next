'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
const responseSchema = z.object({ data: z.object({ taskId: z.string().uuid(), callbackId: z.string().uuid() }).strict().nullable() }).strict()

export function CallbackTaskSource({ taskId }: { taskId: string }) {
  const [source, setSource] = useState<string | null>(null), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const active = useRef(true), lock = useRef(false), controller = useRef<AbortController | null>(null)
  useEffect(() => { active.current = true; return () => { active.current = false; controller.current?.abort() } }, [])
  async function load() {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); controller.current = new AbortController()
    try {
      const response = await fetch(`/api/tasks/${taskId}/callback-source`, { cache: 'no-store', signal: controller.current.signal })
      if (!response.ok) throw new Error('Unavailable')
      const data = responseSchema.parse(await response.json()).data
      if (data && data.taskId !== taskId) throw new Error('Unexpected task')
      if (active.current) { setSource(data?.callbackId ?? null); setLoaded(true) }
    } catch { if (active.current && !controller.current.signal.aborted) setError('Could not load this callback source. Organization admin and CRM access are required.') }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  return <div className="space-y-2 text-sm"><Button type="button" variant="outline" disabled={busy} onClick={() => void load()}>Show callback source</Button>{source && <p><Link className="underline" href={`/settings?section=receptionist&callback=${source}`}>Open source callback</Link></p>}{loaded && !source && <p>No website callback handoff is recorded for this task.</p>}{error && <p role="alert">{error}</p>}</div>
}
