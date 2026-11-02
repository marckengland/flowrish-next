'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, PhoneIncoming } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { receptionistGreeting, type ReceptionistConfig } from '@/lib/receptionist'
import { ReceptionistPreview } from './receptionist-preview'
import { ReceptionistReadinessChecklist } from './receptionist-readiness-checklist'
import { KnowledgeGapsInbox } from './knowledge-gaps-inbox'
import { WebsiteReceptionistSettings } from './website-receptionist-settings'

interface SettingsData {
  config: ReceptionistConfig | null
  businessName: string
  currentUserId: string
  webhookPath: string
  members: Array<{ id: string; name: string }>
  stages: Array<{ id: string; name: string; pipeline: { name: string } }>
  calls: Array<{ id: string; status: string; createdAt: string; leadId: string | null; fullName: string; phone: string; reason: string; messages: Array<{ role: string; content: string }> }>
}

const selectClass = 'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function ReceptionistSettings(): React.JSX.Element {
  const [data, setData] = useState<SettingsData | null>(null)
  const [config, setConfig] = useState<ReceptionistConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/receptionist')
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not load receptionist settings.')
      const next = body as SettingsData
      setData(next)
      setConfig(next.config ?? {
        enabled: false, businessName: next.businessName, knowledge: '', mode: 'after_hours',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, opensAt: '09:00', closesAt: '17:00',
        businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: next.currentUserId, stageId: next.stages[0]?.id ?? '',
      })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load settings.') }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  function update<K extends keyof ReceptionistConfig>(key: K, value: ReceptionistConfig[K]) {
    setConfig((previous) => previous ? { ...previous, [key]: value } : previous)
    setSaved(false)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const response = await fetch('/api/admin/receptionist', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error?.message ?? 'Could not save receptionist settings.')
      setConfig(body.config)
      setData((previous) => previous ? { ...previous, config: body.config } : previous)
      setSaved(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save settings.') }
    finally { setSaving(false) }
  }

  if (loading) return <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading receptionist settings…</p>
  if (!data || !config) return <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => { setLoading(true); setError(''); void load() }}>Try again</Button></div>

  const hasUnsavedChanges = JSON.stringify(config) !== JSON.stringify(data.config)

  return (
    <div className="flex max-w-[680px] flex-col gap-5">
      <div className="space-y-3 rounded-lg border p-4 text-sm">
        <p className="font-medium">Set up your receptionist</p>
        <ol aria-label="Receptionist setup steps" className="grid gap-3 sm:grid-cols-2">
          <li><span className="font-medium">1. Business and callback team</span><p className="text-muted-foreground">Set your business name, hours, callback owner, and lead stage below.</p></li>
          <li><span className="font-medium">2. Approved knowledge</span><p className="text-muted-foreground">Save FAQs and check public-approved Library documents.</p></li>
          <li><a href="#receptionist-browser-preview" className="font-medium underline">3. Browser conversation</a><p className="text-muted-foreground">Test saved settings before connecting a phone.</p></li>
          <li><span className="font-medium">4. Optional phone connection</span><p className="text-muted-foreground">Configure and test incoming phone routing separately.</p></li>
        </ol>
        <p>{hasUnsavedChanges ? 'Unsaved settings' : 'Settings saved'} · {data.config?.enabled ? 'Reception enabled' : 'Reception off'}</p>
      </div>
      <Card>
        <CardHeader className="flex-col items-start gap-2">
          <CardTitle className="flex items-center gap-2"><PhoneIncoming className="size-4" aria-hidden="true" />AI receptionist</CardTitle>
          <p className="text-sm text-muted-foreground">Answer basic questions and turn confirmed caller messages into leads and callback tasks.</p>
          <p className="text-xs text-muted-foreground">Saved setting: {data.config?.enabled ? 'Enabled' : 'Off'}. Calls also require the Twilio number setup below.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-5">
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={config.enabled} onChange={(event) => update('enabled', event.target.checked)} className="size-4 accent-primary" />Enable AI receptionist</label>
            <label className="block space-y-1.5 text-sm font-medium"><span>Business name</span><Input required maxLength={120} value={config.businessName} onChange={(event) => update('businessName', event.target.value)} /></label>
            <div aria-label="Greeting preview" className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm"><p className="font-medium">Greeting preview · current input</p><p className="break-words">{config.businessName.trim() ? receptionistGreeting(config.businessName.trim()) : 'Enter your business name to preview the greeting.'}</p></div>
            <label className="block space-y-1.5 text-sm font-medium"><span id="receptionist-knowledge-label">Business information and FAQs</span><textarea aria-labelledby="receptionist-knowledge-label" rows={6} maxLength={8000} value={config.knowledge} onChange={(event) => update('knowledge', event.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-describedby="receptionist-knowledge-help" /><span id="receptionist-knowledge-help" className="block text-xs font-normal text-muted-foreground">Add services, prices, location, and approved answers. For anything missing, the receptionist offers a callback.</span></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>When to answer</span><select value={config.mode} onChange={(event) => update('mode', event.target.value as ReceptionistConfig['mode'])} className={selectClass}><option value="after_hours">After business hours</option><option value="always">Every incoming call</option></select></label>
            {config.mode === 'after_hours' && <label className="block space-y-1.5 text-sm font-medium"><span>During business hours, forward to</span><Input type="tel" placeholder="+639171234567" required={config.enabled} value={config.forwardTo} onChange={(event) => update('forwardTo', event.target.value)} /><span className="block text-xs font-normal text-muted-foreground">Use a different number from the Twilio number callers dial.</span></label>}
            <fieldset className="space-y-3 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">Business hours and callback schedule</legend>
              <label className="block space-y-1.5 text-sm font-medium"><span>Time zone</span><Input required value={config.timeZone} placeholder="Asia/Manila" onChange={(event) => update('timeZone', event.target.value)} /></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5 text-sm font-medium"><span>Opens at</span><Input type="time" required value={config.opensAt} onChange={(event) => update('opensAt', event.target.value)} /></label>
                <label className="block space-y-1.5 text-sm font-medium"><span>Closes at</span><Input type="time" required value={config.closesAt} onChange={(event) => update('closesAt', event.target.value)} /></label>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1">{days.map((day, index) => <label key={day} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={config.businessDays.includes(index)} onChange={(event) => update('businessDays', event.target.checked ? [...config.businessDays, index].sort() : config.businessDays.filter((value) => value !== index))} className="size-4 accent-primary" />{day}</label>)}</div>
              <p className="text-xs text-muted-foreground">Callback tasks are due at the next business opening. Use one opening and closing time per day.</p>
            </fieldset>
            <label className="block space-y-1.5 text-sm font-medium"><span>Assign callbacks to</span><select required={config.enabled} value={config.assigneeId} onChange={(event) => update('assigneeId', event.target.value)} className={selectClass}>{data.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
            <label className="block space-y-1.5 text-sm font-medium"><span>New lead stage</span><select required={config.enabled} value={config.stageId} onChange={(event) => update('stageId', event.target.value)} className={selectClass}><option value="" disabled>Select an open stage</option>{data.stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.pipeline.name} / {stage.name}</option>)}</select></label>
            {!data.stages.length && <p className="text-sm text-muted-foreground">Set up your <Link href="/pipeline" className="underline">sales pipeline</Link> before saving receptionist settings.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {saved && <p role="status" className="text-sm text-foreground">Receptionist settings saved.</p>}
            <Button type="submit" disabled={saving || (config.enabled && !data.stages.length)}>{saving && <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}{saving ? 'Saving…' : 'Save receptionist settings'}</Button>
          </form>
        </CardContent>
      </Card>
      <ReceptionistReadinessChecklist key={`checklist:${JSON.stringify(data.config)}:${hasUnsavedChanges}`} hasUnsavedChanges={hasUnsavedChanges} />
      <KnowledgeGapsInbox />
      <WebsiteReceptionistSettings />
      <ReceptionistPreview key={`${JSON.stringify(data.config)}:${hasUnsavedChanges}`} hasSavedSettings={Boolean(data.config)} hasUnsavedChanges={hasUnsavedChanges} />
      <Card>
        <CardHeader><CardTitle>Connect your incoming number</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="font-medium">4. Optional phone connection</p>
          <p>Browser preview does not connect a number or enable reception. Phone routing requires separate configuration and a real test call.</p>
          <p>First save your Twilio credentials and Auth Token in Calling &amp; voice. Then open your phone number in Twilio and set its incoming call webhook to this URL, using HTTP POST.</p>
          <label className="block space-y-1.5 font-medium"><span>Incoming call webhook URL</span><Input readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}${data.webhookPath}`} onFocus={(event) => event.target.select()} /></label>
          <p className="text-xs text-muted-foreground">Use this on the phone number. Keep the existing TwiML App URL for outgoing calls. Call the number to verify the greeting, FAQ answers, and confirmed callback.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent receptionist calls</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!data.calls.length ? <p className="text-sm text-muted-foreground">Incoming calls will appear here. Confirmed callback requests also appear in Tasks and the lead’s activity timeline.</p> : data.calls.map((call) => (
            <div key={call.id} className="space-y-1 border-b pb-4 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm"><span className="font-medium">{call.fullName || call.phone || 'Unknown caller'}</span><span className="text-xs text-muted-foreground">{({ completed: 'Callback saved', incomplete: 'Not finished', active: 'In progress', forwarded: 'Forwarded to team' } as Record<string, string>)[call.status] ?? call.status}</span></div>
              <p className="text-xs text-muted-foreground">{new Date(call.createdAt).toLocaleString()} {call.phone}</p>
              {call.reason && <p className="text-sm">{call.reason}</p>}
              {call.leadId && <Link href={`/leads/${call.leadId}`} className="inline-block text-sm underline">View lead</Link>}
              {!!call.messages.length && <details className="pt-1 text-sm"><summary className="cursor-pointer text-muted-foreground">View conversation</summary><div className="mt-2 space-y-2">{call.messages.map((message, index) => <p key={index} className="whitespace-pre-wrap break-words"><span className="font-medium">{message.role === 'user' ? 'Caller' : 'Receptionist'}: </span>{message.content}</p>)}</div></details>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
