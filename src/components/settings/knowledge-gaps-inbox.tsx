'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { gapDetailSchema, gapFaqInputSchema, gapKeySchema, gapListSchema, gapReviewInputSchema, type KnowledgeGapDetail, type KnowledgeGapGroup, type KnowledgeGapList } from '@/lib/knowledge-gaps'
import { faqDraftResultSchema, type FaqDraftResult } from '@/lib/rehearsal-faq'

type GapStatus = 'open' | 'resolved' | 'all'
type Busy = '' | 'list' | 'detail' | 'save' | 'faq'
const baseUrl = '/api/admin/receptionist/knowledge-gaps'
const discardWarning = 'Replace your unsaved resolution notes and manual retest confirmation? Cancel to keep them and resolve the gap first.'

function faqSummary(group: KnowledgeGapGroup): string {
  const counts = group.faqCounts
  return `${counts.draft} draft · ${counts.published} published · ${counts.approved} approved · ${counts.archived} archived`
}

export function KnowledgeGapsInbox(): React.JSX.Element {
  const headingId = useId()
  const [status, setStatus] = useState<GapStatus>('open')
  const [list, setList] = useState<KnowledgeGapList | null>(null)
  const [detail, setDetail] = useState<KnowledgeGapDetail | null>(null)
  const [notes, setNotes] = useState('')
  const [retested, setRetested] = useState(false)
  const [faqResult, setFaqResult] = useState<FaqDraftResult | null>(null)
  const [busy, setBusy] = useState<Busy>('')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState('')
  const request = useRef<AbortController | null>(null)
  const writing = useRef(false)
  const dirty = Boolean(detail && (notes !== (detail.group.resolution?.notes ?? '') || retested))

  useEffect(() => () => { request.current?.abort() }, [])

  useEffect(() => {
    if (!dirty) return
    function beforeUnload(event: BeforeUnloadEvent): void {
      event.preventDefault()
      event.returnValue = ''
    }
    function beforeNavigate(event: MouseEvent): void {
      if (!(event.target instanceof Element)) return
      const settingsTab = event.target.closest('nav[aria-label="Settings sections"] button')
      const leavesSettingsTab = settingsTab && settingsTab.getAttribute('aria-current') !== 'page'
      if (!event.target.closest('a[href]') && !leavesSettingsTab) return
      if (!window.confirm(discardWarning)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeNavigate, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeNavigate, true)
    }
  }, [dirty])

  function mayReplaceEdits(): boolean {
    return !writing.current && (!dirty || window.confirm(discardWarning))
  }

  function start(kind: Busy): AbortController {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(kind)
    setError('')
    setNotice('')
    return controller
  }

  function current(controller: AbortController): boolean {
    return !controller.signal.aborted && request.current === controller
  }

  function finish(controller: AbortController): void {
    if (current(controller)) {
      setBusy('')
      request.current = null
      writing.current = false
    }
  }

  function receiveDetail(next: KnowledgeGapDetail): void {
    setDetail(next)
    setNotes(next.group.resolution?.notes ?? '')
    setRetested(false)
    setConflict(false)
  }

  function updateGroup(group: KnowledgeGapGroup): void {
    setList(previous => {
      if (!previous) return previous
      const groups = previous.groups.filter(item => item.key !== group.key)
      if (status === 'all' || status === group.status) {
        const index = previous.groups.findIndex(item => item.key === group.key)
        groups.splice(index < 0 ? 0 : index, 0, group)
      }
      return { ...previous, groups: groups.slice(0, 20) }
    })
  }

  async function loadList(nextStatus = status, page = 1): Promise<void> {
    if (!mayReplaceEdits()) return
    const controller = start('list')
    setStatus(nextStatus)
    setList(null)
    setDetail(null)
    setNotes('')
    setRetested(false)
    setConflict(false)
    setFaqResult(null)
    try {
      const response = await fetch(`${baseUrl}?status=${nextStatus}&page=${page}`, { signal: controller.signal })
      if (!response.ok) throw new Error('Request failed')
      const next = gapListSchema.parse((await response.json())?.data)
      if (current(controller)) setList(next)
    } catch {
      if (current(controller)) setError('Could not load knowledge gaps. Use Load knowledge gaps to try again.')
    } finally { finish(controller) }
  }

  async function loadDetail(key: string, page = 1): Promise<void> {
    if (!mayReplaceEdits()) return
    const controller = start('detail')
    if (detail?.group.key !== key) {
      setDetail(null)
      setFaqResult(null)
    } else if (faqResult) {
      setNotice(notice)
    }
    try {
      gapKeySchema.parse(key)
      const response = await fetch(`${baseUrl}/${key}?page=${page}`, { signal: controller.signal })
      if (!response.ok) throw new Error('Request failed')
      const next = gapDetailSchema.parse((await response.json())?.data)
      if (next.group.key !== key) throw new Error('Unexpected question')
      if (current(controller)) {
        receiveDetail(next)
        setFaqResult(null)
        const listedGroup = list?.groups.find(group => group.key === next.group.key)
        if (list && listedGroup?.version !== next.group.version) {
          setList(null)
          setNotice('This question changed since the list was loaded. Use Load knowledge gaps to refresh the list before paging again.')
        } else if (listedGroup) {
          updateGroup(next.group)
        }
      }
    } catch {
      if (current(controller)) setError('Could not load this question. Open the question again to retry.')
    } finally { finish(controller) }
  }

  async function write(action: 'resolve' | 'reopen' | 'faq'): Promise<void> {
    if (!detail || request.current || writing.current || conflict || (action === 'resolve' && (!retested || detail.group.status !== 'open'))) return
    writing.current = true
    const controller = start(action === 'faq' ? 'faq' : 'save')
    const key = detail.group.key
    try {
      gapKeySchema.parse(key)
      const input = action === 'faq'
        ? gapFaqInputSchema.parse({ expectedVersion: detail.group.version })
        : gapReviewInputSchema.parse({ expectedVersion: detail.group.version, action, retested: action === 'resolve' && retested, notes })
      const response = await fetch(`${baseUrl}/${key}${action === 'faq' ? '/faq' : ''}`, {
        method: action === 'faq' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: controller.signal,
      })
      if (!current(controller)) return
      if (response.status === 409) {
        setConflict(true)
        setError('This question changed. Your local notes and retest confirmation are kept. Reload the latest question before saving again; reloading replaces local edits.')
        return
      }
      if (!response.ok) {
        if (response.status === 400) {
          const body = await response.json()
          if (current(controller) && body?.error?.code === 'KNOWLEDGE_LIMIT') {
            setError('The knowledge library is full. Archive a document before creating another FAQ draft.')
            return
          }
        }
        throw new Error('Request failed')
      }
      const body = await response.json()
      if (!current(controller)) return
      if (action === 'faq') {
        const result = faqDraftResultSchema.parse(body?.data)
        setFaqResult(result)
        setNotice(result.created ? 'FAQ draft created. Write and review its answer in the knowledge library.' : 'Existing FAQ found. Review it in the knowledge library.')
        // Refresh the saved version and counts after the explicit draft action.
        try {
          const refreshed = await fetch(`${baseUrl}/${key}?page=${detail.page}`, { signal: controller.signal })
          if (!refreshed.ok) throw new Error('Refresh failed')
          const next = gapDetailSchema.parse((await refreshed.json())?.data)
          if (next.group.key !== key) throw new Error('Unexpected question')
          if (current(controller)) {
            setDetail(next)
            if (next.group.version !== detail.group.version) setRetested(false)
          }
        } catch {
          if (current(controller)) {
            setList(null)
            setRetested(false)
            setConflict(true)
            setError('The FAQ draft was saved, but the latest question could not load. Reload latest question before making another change. Your local notes are kept.')
          }
          return
        }
      } else {
        const next = gapDetailSchema.parse(body?.data)
        if (next.group.key !== key) throw new Error('Unexpected question')
        receiveDetail(next)
        setNotice(action === 'resolve' ? 'Gap resolved after your manual retest. Report flags and FAQ publication are unchanged.' : 'Gap reopened.')
      }
      if (!current(controller)) return
      try {
        // Mutations can move rows across offset pages; refill this page before paging again.
        const refreshed = await fetch(`${baseUrl}?status=${status}&page=${list?.page ?? 1}`, { signal: controller.signal })
        if (!refreshed.ok) throw new Error('Refresh failed')
        const next = gapListSchema.parse((await refreshed.json())?.data)
        if (current(controller)) setList(next)
      } catch {
        if (current(controller)) {
          setList(null)
          setError('Your action was saved, but the question list could not refresh. Use Load knowledge gaps before paging again.')
        }
      }
    } catch {
      if (current(controller)) setError('Could not save this action. Your local edits are kept. Try again, or reload the latest question.')
    } finally { finish(controller) }
  }

  const writeBusy = busy === 'save' || busy === 'faq'
  return <section aria-labelledby={headingId}>
    <Card>
      <CardHeader className="items-start gap-2">
        <CardTitle id={headingId}>Knowledge gaps</CardTitle>
        <p className="text-sm text-muted-foreground">Review questions flagged in saved rehearsals, write FAQ answers, and resolve gaps after manually retesting.</p>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">Resolving a gap does not publish or approve an FAQ, change report flags, or run a new conversation.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1.5 text-sm font-medium"><span className="block">Knowledge gap status</span>
            <select value={status} disabled={writeBusy} onChange={event => {
              const next = event.target.value as GapStatus
              if (list || busy === 'list' || detail) void loadList(next)
              else setStatus(next)
            }} className="min-h-11 rounded-md border border-input bg-background px-3 text-sm">
              <option value="open">Open</option><option value="resolved">Resolved</option><option value="all">All</option>
            </select>
          </label>
          <Button type="button" variant="outline" className="min-h-11" disabled={writeBusy || busy === 'list'} onClick={() => void loadList()}>Load knowledge gaps</Button>
        </div>
        {busy && <p role="status" className="text-sm text-muted-foreground">{busy === 'list' ? 'Loading knowledge gaps…' : busy === 'detail' ? 'Loading question…' : busy === 'faq' ? 'Opening FAQ draft…' : 'Saving gap review…'}</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {list && <div className="space-y-3">
          {!list.groups.length && <p className="text-sm text-muted-foreground">No {status === 'all' ? '' : `${status} `}knowledge gaps on this page.</p>}
          <ul className="space-y-3">
            {list.groups.map(group => <li key={group.key} className="min-w-0 space-y-2 rounded-lg border p-4">
              <h3 className="break-words font-medium [overflow-wrap:anywhere]">{group.question}</h3>
              <p className="text-sm">{group.occurrenceCount} {group.occurrenceCount === 1 ? 'occurrence' : 'occurrences'}</p>
              <p className="break-words text-sm text-muted-foreground">{group.status === 'open' ? 'Open' : 'Resolved'} · Latest: <time dateTime={group.latestAt}>{new Date(group.latestAt).toLocaleString()}</time></p>
              <p className="text-sm text-muted-foreground">{faqSummary(group)}</p>
              <Button type="button" variant="outline" className="min-h-11" disabled={writeBusy} aria-label={`Open question: ${group.question}`} onClick={() => void loadDetail(group.key)}>Open question</Button>
            </li>)}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" className="min-h-11" disabled={writeBusy || list.page <= 1} onClick={() => void loadList(status, list.page - 1)}>Previous questions</Button>
            <span className="text-sm">Questions page {list.page}</span>
            <Button type="button" variant="outline" className="min-h-11" disabled={writeBusy || !list.hasMore} onClick={() => void loadList(status, list.page + 1)}>Next questions</Button>
          </div>
        </div>}
        {detail && <div className="min-w-0 space-y-4 rounded-lg border p-4">
          <h3 className="break-words font-medium [overflow-wrap:anywhere]">Review: {detail.group.question}</h3>
          <p className="text-sm">Gap status: {detail.group.status === 'open' ? 'Open' : 'Resolved'}</p>
          <p className="text-sm text-muted-foreground">{faqSummary(detail.group)}</p>
          {detail.group.changedSinceResolution && <p className="text-sm">Source changes or new flags reopen a resolved gap. Review the current sources and manually retest before resolving it again.</p>}
          <ul className="space-y-3">
            {detail.occurrences.map(item => <li key={`${item.rehearsalId}:${item.messageIndex}`} className="min-w-0 space-y-1">
              <a href={item.rehearsalUrl} className="inline-flex min-h-11 items-center break-words text-sm underline underline-offset-4 [overflow-wrap:anywhere]">{item.title}</a>
              <p className="text-sm text-muted-foreground">Message {item.messageIndex + 1} · <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time></p>
              {item.faq ? <a href={item.faq.knowledgeUrl} className="inline-flex min-h-11 items-center break-words text-sm underline underline-offset-4 [overflow-wrap:anywhere]">{item.faq.title} ({item.faq.status})</a> : <p className="text-sm text-muted-foreground">No FAQ linked to this occurrence.</p>}
            </li>)}
          </ul>
          {!detail.occurrences.length && <p className="text-sm text-muted-foreground">No occurrences on this page.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" className="min-h-11" disabled={writeBusy || detail.page <= 1} onClick={() => void loadDetail(detail.group.key, detail.page - 1)}>Previous occurrences</Button>
            <span className="text-sm">Occurrences page {detail.page}</span>
            <Button type="button" variant="outline" className="min-h-11" disabled={writeBusy || !detail.hasMore} onClick={() => void loadDetail(detail.group.key, detail.page + 1)}>Next occurrences</Button>
          </div>
          {faqResult ? <a href={faqResult.knowledgeUrl} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Open FAQ draft</a>
            : !detail.occurrences.some(item => item.faq) && <Button type="button" variant="outline" className="min-h-11" disabled={Boolean(busy) || conflict} onClick={() => void write('faq')}>Create or open FAQ draft</Button>}
          <p className="text-sm text-muted-foreground">Write the answer and review it in the knowledge library. Publish it and approve it for the receptionist explicitly when ready.</p>
          <label className="block space-y-1.5 text-sm font-medium"><span>Resolution notes</span><textarea value={notes} maxLength={2000} disabled={writeBusy} onChange={event => setNotes(event.target.value)} className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></label>
          <p className="text-sm text-muted-foreground">{notes.length}/2000 characters. Notes stay with this gap review.</p>
          {detail.group.status === 'open' && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={retested} disabled={writeBusy} onChange={event => setRetested(event.target.checked)} className="size-4 shrink-0" />I manually retested this question</label>}
          <div className="flex flex-wrap gap-3">
            {detail.group.status === 'open'
              ? <Button type="button" className="min-h-11" disabled={!retested || Boolean(busy) || conflict} onClick={() => void write('resolve')}>Resolve gap</Button>
              : <Button type="button" variant="outline" className="min-h-11" disabled={Boolean(busy) || conflict} onClick={() => void write('reopen')}>Reopen gap</Button>}
            <Button type="button" variant="outline" className="min-h-11" disabled={writeBusy} onClick={() => void loadDetail(detail.group.key, detail.page)}>Reload latest question</Button>
          </div>
          {dirty && <p className="text-sm text-muted-foreground">{conflict ? 'Your local review edits are kept. Reload the latest question before saving this review.' : <>You have unsaved edits. {detail.group.status === 'resolved' ? 'Reopen the gap' : 'Resolve the gap'} to save the review, or reload the question to replace your local edits.</>}</p>}
        </div>}
      </CardContent>
    </Card>
  </section>
}
