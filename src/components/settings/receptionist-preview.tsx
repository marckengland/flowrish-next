'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { type CallState } from '@/lib/receptionist'
import { ReceptionistMicrophone } from './receptionist-microphone'
import { ReceptionistScenarios } from './receptionist-scenarios'

interface Readiness {
  saved: boolean
  settingsVersion: string | null
  approvedDocuments: number
  hasManualKnowledge: boolean
  voiceConfigured: boolean
  hasAuthToken: boolean
}

interface PreviewResult {
  state: CallState
  settingsVersion: string
  reply: string
  finished: boolean
  callback: { fullName: string; phone: string; reason: string } | null
  sources: Array<{ id: string; title: string; revision: number }>
  generation?: { mode: 'ai' | 'fallback'; reason?: string }
}

export function ReceptionistPreview({ hasSavedSettings, hasUnsavedChanges }: {
  hasSavedSettings: boolean
  hasUnsavedChanges: boolean
}): React.JSX.Element {
  const [readiness, setReadiness] = useState<Readiness | null>(null)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([])
  const [speech, setSpeech] = useState('')
  const [dictating, setDictating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [supported, setSupported] = useState(false)
  const [readAloud, setReadAloud] = useState(false)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const readAloudRef = useRef(false)
  const request = useRef<AbortController | null>(null)
  const readinessRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    setSupported(Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance))
    return () => {
      request.current?.abort()
      readinessRequest.current?.abort()
      window.speechSynthesis?.cancel()
    }
  }, [])

  function endPreview() {
    request.current?.abort()
    window.speechSynthesis?.cancel()
    setResult(null)
    setMessages([])
    setSpeech('')
    setDictating(false)
    setBusy(false)
    setError('')
  }

  async function checkSetup() {
    const controller = new AbortController()
    readinessRequest.current = controller
    setChecking(true)
    setError('')
    try {
      const response = await fetch('/api/admin/receptionist/readiness', { signal: controller.signal })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not check saved setup.')
      if (controller.signal.aborted) return
      const next = body.data as Readiness
      if (result && result.settingsVersion !== next.settingsVersion) endPreview()
      setReadiness(next)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not check saved setup.')
    } finally {
      if (!controller.signal.aborted) setChecking(false)
    }
  }

  async function send(input?: { speech?: string; digits?: string }) {
    if (busy || dictating || hasUnsavedChanges || !hasSavedSettings) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    try {
      const payload = input && result ? { state: result.state, settingsVersion: result.settingsVersion, ...input } : {}
      const response = await fetch('/api/admin/receptionist/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal,
      })
      const body = await response.json()
      if (controller.signal.aborted) return
      if (!response.ok) {
        if (response.status === 409) { request.current = null; endPreview() }
        throw new Error(body.error?.message ?? 'Could not run preview. Please try again.')
      }
      const next = body.data as PreviewResult
      setResult(next)
      setMessages((previous) => [
        ...(input ? previous : []),
        ...(input ? [{ role: 'Caller', content: input.speech ?? 'Pressed 1 to confirm' }] : []),
        { role: 'Receptionist', content: next.reply },
      ])
      setSpeech('')
      if (readAloudRef.current && window.speechSynthesis) {
        try {
          window.speechSynthesis.cancel()
          const utterance = new SpeechSynthesisUtterance(next.reply)
          utterance.onerror = (event) => {
            if (event.error !== 'canceled' && event.error !== 'interrupted') setPlaybackFailed(true)
          }
          window.speechSynthesis.speak(utterance)
        } catch {
          setPlaybackFailed(true)
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not run preview.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  return (
    <Card id="receptionist-browser-preview">
      <CardHeader className="flex-col items-start gap-2">
        <CardTitle>Check knowledge and test</CardTitle>
        <p className="text-sm text-muted-foreground">Try a conversation with text or microphone input using saved settings, even with reception off and no phone connected. Existing AI usage rules apply.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">2. Check approved knowledge</p>
          <p className="text-muted-foreground">Use your saved FAQs and <Link href="/knowledge" className="underline">Library</Link> documents approved for public receptionist answers. Internal documents are excluded.</p>
          <Button variant="outline" disabled={checking} onClick={() => { void checkSetup() }}>{checking ? 'Checking…' : 'Check saved setup'}</Button>
          {readiness && <div className="space-y-1" aria-live="polite">
            <p>{readiness.saved ? 'Settings saved.' : 'Save receptionist settings first.'} {readiness.approvedDocuments} approved public documents. {readiness.hasManualKnowledge ? 'Saved FAQs available.' : 'No saved FAQs.'}</p>
            {!readiness.approvedDocuments && !readiness.hasManualKnowledge && <p className="text-muted-foreground">Missing answers will lead to callback collection. Add approved knowledge to answer business questions.</p>}
            <p className="text-muted-foreground">{readiness.voiceConfigured && readiness.hasAuthToken ? 'Phone credentials are present.' : 'Phone credentials are missing.'} Phone routing has not been verified. Browser preview needs no phone credentials.</p>
            <p className="text-xs text-muted-foreground">This checks saved setup now. Recheck after changing Library approvals.</p>
          </div>}
        </div>
        <p className="text-sm font-medium">3. Test in your browser</p>
        <p className="text-sm text-muted-foreground">Preview only: no phone call or audio recording stored by Flowrish. Preview never saves leads, tasks, or activities to your CRM.</p>
        {hasUnsavedChanges && <p className="text-sm font-medium">Save your changes before testing. The greeting above reflects your current edits; conversations use saved settings.</p>}
        {!hasSavedSettings && !hasUnsavedChanges && <p className="text-sm font-medium">Save receptionist settings before testing.</p>}
        <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={readAloud} disabled={!supported || dictating} onChange={(event) => {
          readAloudRef.current = event.target.checked
          setReadAloud(event.target.checked)
          if (!event.target.checked) window.speechSynthesis?.cancel()
        }} />Read replies aloud</label>
        {!supported && <p className="text-xs text-muted-foreground">Read-aloud is unavailable in this browser. You can still test the full conversation with text.</p>}
        {playbackFailed && <p className="text-xs text-muted-foreground">Read-aloud could not play. Continue using the text replies.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {result?.generation?.mode === 'ai' && <p role="status" className="text-xs text-muted-foreground">AI request completed for this turn.</p>}
        {result?.generation?.mode === 'fallback' && <p role="status" className="text-sm text-muted-foreground">{({ rate_limited: 'AI request limit reached.', timeout: 'The AI request timed out.', invalid_json: 'The AI response could not be read.', invalid_response: 'The AI response could not be read.', provider_unavailable: 'The AI provider is unavailable.', service_unavailable: 'The AI service is unavailable.' } as Record<string, string>)[result.generation.reason ?? ''] ?? 'The AI service is unavailable.'} This preview is collecting a callback message instead. End this preview and try again later to retry AI.</p>}
        {!result ? <Button disabled={busy || hasUnsavedChanges || !hasSavedSettings} onClick={() => { void send() }}>{busy ? 'Starting preview…' : 'Start browser preview'}</Button> : <>
          <div role="log" aria-label="Preview conversation" aria-live="polite" className="max-h-96 space-y-3 overflow-y-auto rounded-lg border p-4 text-sm">
            {messages.map((message, index) => <p key={index} className="whitespace-pre-wrap break-words"><span className="font-medium">{message.role}: </span>{message.content}</p>)}
          </div>
          {!!result.sources.length && <details className="text-xs text-muted-foreground" open><summary className="cursor-pointer">Sources for the latest reply · admin only</summary><ul className="mt-2 space-y-1">{result.sources.map((source) => <li key={source.id} className="break-words">{source.title} · revision {source.revision}</li>)}</ul></details>}
          {result.finished ? <p className="text-sm font-medium">Conversation tested in browser. Phone routing has not been verified.</p> : <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); if (speech.trim()) void send({ speech: speech.trim() }) }}>
            <ReceptionistScenarios disabled={busy || dictating || hasUnsavedChanges || !hasSavedSettings} awaitingConfirmation={Boolean(result.state.awaitingConfirmation)} onSelect={setSpeech} />
            <label className="block space-y-1.5 text-sm font-medium"><span>Caller message</span><Input value={speech} maxLength={2000} disabled={busy || dictating || hasUnsavedChanges || !hasSavedSettings} onChange={(event) => setSpeech(event.target.value)} placeholder="Type what a caller would say" /></label>
            <ReceptionistMicrophone value={speech} onChange={setSpeech} disabled={busy || hasUnsavedChanges || !hasSavedSettings} onActiveChange={setDictating} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || dictating || hasUnsavedChanges || !hasSavedSettings || !speech.trim()}>{busy ? 'Waiting for reply…' : 'Send caller message'}</Button>
              {result.state.awaitingConfirmation && <Button type="button" variant="outline" disabled={busy || dictating || hasUnsavedChanges || !hasSavedSettings} onClick={() => { void send({ digits: '1' }) }}>Press 1 to confirm</Button>}
            </div>
          </form>}
          {result.callback && <div className="space-y-2 rounded-lg border p-4 text-sm"><p className="font-medium">Preview-only callback summary</p><dl className="space-y-2"><div><dt className="text-muted-foreground">Name</dt><dd>{result.callback.fullName}</dd></div><div><dt className="text-muted-foreground">Phone</dt><dd>{result.callback.phone}</dd></div><div><dt className="text-muted-foreground">Reason</dt><dd className="whitespace-pre-wrap break-words">{result.callback.reason}</dd></div></dl><p>Nothing was saved to your CRM. No callback was scheduled.</p></div>}
          <Button variant="outline" onClick={endPreview}>{result.finished ? 'Reset preview' : 'End preview'}</Button>
        </>}
      </CardContent>
    </Card>
  )
}
