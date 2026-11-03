'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { createDemoState, reduceDemo, type DemoBusiness, type DemoOutcome } from '@/lib/receptionist-demo'

const field = 'mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-sm'
const outcomeLabels: Record<DemoOutcome, string> = { reached: 'Reached', no_answer: 'No answer', retry: 'Retry requested' }

export function ReceptionistDemo({ business }: { business: DemoBusiness }): React.JSX.Element {
  const [state, dispatch] = useReducer((current: ReturnType<typeof createDemoState>, action: Parameters<typeof reduceDemo>[1]) => reduceDemo(current, action, business), business, createDemoState)
  const [message, setMessage] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const transcript = useRef<HTMLOListElement>(null)
  useEffect(() => { const element = transcript.current; if (element) element.scrollTop = element.scrollHeight }, [state.messages])
  function send(text: string) { dispatch({ type: 'message', text }); if (text.trim() && text.trim().length <= 1000) setMessage('') }
  function restart() { dispatch({ type: 'reset' }); setMessage(''); input.current?.focus() }
  const editable = ['editing', 'review'].includes(state.callbackStep)

  return <div className="min-w-0 space-y-6">
    <header className="space-y-3">
      <Link href="/receptionist" className="inline-flex min-h-11 items-center text-sm underline">Receptionist home</Link>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight">Demo mode</h1><p className="break-words text-sm text-muted-foreground">Practice the receptionist workflow for {business.name}.</p></div><Button variant="outline" onClick={restart}>Restart demo</Button></div>
      <div className="space-y-1 rounded-xl border bg-muted/30 p-4 text-sm"><p className="font-semibold">Prewritten replies. No live AI.</p><p>Approved Library excerpts and saved hours are used for this walkthrough. This does not test AI quality or connectivity, enable the widget, place calls, or create real callback or CRM records.</p><p className="text-muted-foreground">Use fictional details only. Demo entries stay in this page’s memory. Restarting or reloading clears them.</p></div>
    </header>
    <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
      <section aria-labelledby="demo-conversation-heading" className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5">
        <div className="space-y-1"><h2 id="demo-conversation-heading" className="text-lg font-semibold">Try a conversation</h2><p className="text-sm text-muted-foreground">Choose a question or type your own. Replies follow simple demo rules. The latest 40 messages are shown.</p></div>
        <div className="flex flex-wrap gap-2">{[{ label: 'Ask about services', text: 'What services do you offer?' }, { label: 'Ask about hours', text: 'What are your callback hours?' }, { label: 'Ask about pricing', text: 'What does it cost?' }, { label: 'Practice a callback', text: 'Please call me back.' }].map(choice => <Button key={choice.label} variant="outline" className="min-h-11 whitespace-normal" onClick={() => send(choice.text)}>{choice.label}</Button>)}</div>
        <ol ref={transcript} role="log" aria-label="Demo conversation" aria-live="polite" aria-relevant="additions text" className="max-h-[28rem] space-y-3 overflow-y-auto rounded-lg border p-3">{state.messages.map((entry, index) => <li key={index} className={`min-w-0 rounded-lg p-3 text-sm ${entry.role === 'visitor' ? 'bg-muted/50' : 'bg-background'}`}><p className="mb-1 text-xs font-semibold text-muted-foreground">{entry.role === 'visitor' ? 'Sample visitor' : 'Receptionist · prewritten demo'}</p><p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{entry.text}</p></li>)}</ol>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); send(message) }}><label className="block text-sm font-medium">Sample visitor message<input ref={input} className={field} value={message} onChange={event => setMessage(event.target.value)} maxLength={1000} autoComplete="off" placeholder="Ask about pricing, hours, or services" /></label><Button type="submit" className="min-h-11" disabled={!message.trim()}>Send demo message</Button></form>
      </section>
      <section aria-labelledby="demo-workflow-heading" className="min-w-0 space-y-4 rounded-xl border bg-card p-4 sm:p-5">
        <h2 id="demo-workflow-heading" className="text-lg font-semibold">Simulated callback work</h2>
        {state.callbackStep === 'idle' && <p className="text-sm text-muted-foreground">Choose Practice a callback to review fictional details, approve a simulated CRM handoff, and record an outcome.</p>}
        {editable && <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Edit the fictional details before reviewing. Any correction requires a fresh readback and consent.</p>
          <label className="block text-sm font-medium">Sample name<input className={field} value={state.draft.fullName} maxLength={120} autoComplete="off" onChange={event => dispatch({ type: 'edit_callback', field: 'fullName', value: event.target.value })} /></label>
          <label className="block text-sm font-medium">Sample phone<input className={field} type="tel" value={state.draft.phone} maxLength={30} autoComplete="off" onChange={event => dispatch({ type: 'edit_callback', field: 'phone', value: event.target.value })} /></label>
          <label className="block text-sm font-medium">Sample callback reason<textarea className={field} value={state.draft.reason} maxLength={1000} autoComplete="off" onChange={event => dispatch({ type: 'edit_callback', field: 'reason', value: event.target.value })} /></label>
          <Button variant="outline" className="min-h-11" onClick={() => dispatch({ type: 'review_callback' })}>Review simulated callback</Button>
          {state.callbackStep === 'review' && <div className="space-y-3 rounded-lg border p-3"><p className="break-words text-sm [overflow-wrap:anywhere]">Simulated readback: {state.draft.fullName} · {state.draft.phone} · {state.draft.reason}</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={state.callbackConsent} onChange={event => dispatch({ type: 'callback_consent', value: event.target.checked })} />I confirm these fictional callback details.</label><Button className="min-h-11" disabled={!state.callbackConsent} onClick={() => dispatch({ type: 'confirm_callback' })}>Confirm simulated callback</Button></div>}
        </div>}
        {state.callbackStep === 'confirmed' && <div className="space-y-3">
          <p className="text-sm font-medium">Fictional callback confirmed. No real request was submitted.</p>
          {state.handoffStep === 'idle' && <Button className="min-h-11" variant="outline" onClick={() => dispatch({ type: 'preview_handoff' })}>Preview simulated CRM handoff</Button>}
          {state.handoffStep === 'review' && <div className="space-y-3 rounded-lg border p-3"><p className="break-words text-sm">Demo lead: {state.draft.fullName}. Demo task: Callback: {state.draft.fullName}. Assigned to Sample team member. No real owner, deadline, lead, or task will be changed.</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={state.handoffConsent} onChange={event => dispatch({ type: 'handoff_consent', value: event.target.checked })} />I approve this simulated lead and task.</label><Button className="min-h-11 whitespace-normal" disabled={!state.handoffConsent} onClick={() => dispatch({ type: 'confirm_handoff' })}>Create simulated CRM handoff</Button></div>}
          {state.handoffStep === 'created' && <>
            <section aria-label="Simulated CRM receipt" className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm"><h3 className="font-semibold">Simulated CRM receipt</h3><p className="break-words">Demo lead: {state.draft.fullName} · {state.draft.phone}</p><p className="break-words">Demo task: Callback: {state.draft.fullName}</p><p>Owner: Sample team member</p><p className="font-medium">Callback and task: {state.closed ? 'Closed' : 'Open'}</p><p className="text-muted-foreground">Browser memory only. No CRM records or callback requests were saved.</p></section>
            {!state.closed && <div className="space-y-3"><label className="block text-sm font-medium">Simulated callback outcome<select className={field} value={state.outcome} onChange={event => dispatch({ type: 'select_outcome', value: event.target.value as DemoOutcome })}>{Object.entries(outcomeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Button variant="outline" className="min-h-11" onClick={() => dispatch({ type: 'preview_outcome' })}>Preview simulated outcome</Button>
              {state.outcomeStep === 'review' && <div className="space-y-3 rounded-lg border p-3"><p className="text-sm">{outcomeLabels[state.outcome]}. {state.outcome === 'reached' ? 'Close the demo callback and complete its demo task.' : 'Keep the demo callback and task open for another attempt.'}</p><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={state.outcomeConsent} onChange={event => dispatch({ type: 'outcome_consent', value: event.target.checked })} />I confirm this simulated outcome.</label><Button className="min-h-11" disabled={!state.outcomeConsent} onClick={() => dispatch({ type: 'confirm_outcome' })}>Record simulated outcome</Button></div>}
            </div>}
            {state.outcomes.length > 0 && <section aria-label="Simulated outcome history" className="space-y-2 text-sm"><h3 className="font-semibold">Simulated outcome history</h3><ol className="list-inside list-decimal">{state.outcomes.map((outcome, index) => <li key={index}>{outcomeLabels[outcome]}</li>)}</ol><p className="text-muted-foreground">The latest 20 simulated outcomes are shown.</p></section>}
          </>}
        </div>}
        {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        {state.messages.length > 1 && !state.error && <p role="status" className="sr-only">{state.messages.at(-1)?.text}</p>}
      </section>
    </div>
  </div>
}
