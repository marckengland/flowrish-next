'use client'

import { useEffect, useRef, useState } from 'react'
import { BookOpen, FileUp, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

const categories = ['PRICING', 'SERVICES', 'FAQ', 'GENERAL'] as const
type Category = typeof categories[number]
interface KnowledgeDocument {
  id: string
  title: string
  category: Category
  contentText: string
  sourceName?: string | null
  sourceMime?: string | null
  revision: number
  publishedTitle: string | null
  publishedCategory: Category | null
  publishedText: string | null
  publishedRevision: number | null
  publishedAt: string | null
  receptionistApprovedRevision: number | null
  archivedAt: string | null
}
interface Draft { title: string; category: Category; contentText: string; sourceName?: string; sourceMime?: string }
const blank: Draft = { title: '', category: 'GENERAL', contentText: '' }
const field = 'w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'
function draftOf(document: KnowledgeDocument): Draft { return { title: document.title, category: document.category, contentText: document.contentText, ...(document.sourceName ? { sourceName: document.sourceName } : {}), ...(document.sourceMime ? { sourceMime: document.sourceMime } : {}) } }
async function responseData<T>(response: Response): Promise<T> {
  const body = await response.json()
  if (!response.ok) throw new Error(`${body.error?.message ?? 'Unable to update knowledge.'}${response.status === 409 ? ' Reload the document to review the current version. Your edits have been kept.' : ''}`)
  return body.data as T
}

export function KnowledgeLibrary(): React.JSX.Element {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([])
  const [selected, setSelected] = useState<KnowledgeDocument | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft>(blank)
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [acknowledged, setAcknowledged] = useState(false)
  const [navigation, setNavigation] = useState<string | null>(null)
  const sequence = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    let current = true
    fetch('/api/knowledge').then(responseData<KnowledgeDocument[]>).then(data => { if (current) setDocuments(data) }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Unable to load knowledge.') }).finally(() => { if (current) setLoading(false) })
    return () => { current = false; mounted.current = false }
  }, [])

  function apply(document: KnowledgeDocument, preserveEdits = false): void {
    setSelected(document)
    setEditing(true)
    if (!preserveEdits) { setDraft(draftOf(document)); setDirty(false) }
    setAcknowledged(false)
    setDocuments(rows => rows.some(row => row.id === document.id) ? rows.map(row => row.id === document.id ? document : row) : [document, ...rows])
  }
  function change(values: Partial<Draft>): void { setDraft(current => ({ ...current, ...values })); setDirty(true) }

  async function navigate(target: string, discard = false): Promise<void> {
    if (busy || loading) return
    if (dirty && !discard) { setNavigation(target); return }
    setNavigation(null)
    setError(null)
    setNotice('')
    setWarnings([])
    setAcknowledged(false)
    if (target === 'new') { setSelected(null); setDraft(blank); setDirty(false); setEditing(true); return }
    setBusy(true)
    const request = ++sequence.current
    try {
      if (target === 'reload' && !selected) {
        const rows = await responseData<KnowledgeDocument[]>(await fetch('/api/knowledge'))
        if (mounted.current && request === sequence.current) { setDocuments(rows); setEditing(false); setDraft(blank); setDirty(false) }
      } else {
        const id = target === 'reload' ? selected!.id : target
        const document = await responseData<KnowledgeDocument>(await fetch(`/api/knowledge/${id}`))
        if (mounted.current && request === sequence.current) apply(document)
      }
    } catch (cause) { if (mounted.current && request === sequence.current) setError(cause instanceof Error ? cause.message : 'Unable to load this document.') }
    finally { if (mounted.current && request === sequence.current) setBusy(false) }
  }

  async function save(): Promise<void> {
    if (busy || selected?.archivedAt) return
    setBusy(true); setError(null); setNotice('')
    try {
      const document = await responseData<KnowledgeDocument>(await fetch(selected ? `/api/knowledge/${selected.id}` : '/api/knowledge', { method: selected ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...draft, ...(selected ? { revision: selected.revision } : {}) }) }))
      if (mounted.current) { apply(document); setNotice('Draft saved. Publish it when the text is ready for Airish.') }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Unable to save the draft.') }
    finally { if (mounted.current) setBusy(false) }
  }

  async function transition(action: 'publish' | 'unpublish' | 'approve_receptionist' | 'revoke_receptionist' | 'archive'): Promise<void> {
    if (!selected || busy) return
    setBusy(true); setError(null); setNotice('')
    try {
      const document = await responseData<KnowledgeDocument>(await fetch(`/api/knowledge/${selected.id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, revision: selected.revision, ...(action === 'approve_receptionist' ? { publishedRevision: selected.publishedRevision, acknowledged } : {}) }) }))
      if (mounted.current) { apply(document, dirty); setNotice(action === 'publish' ? 'Published for Airish. Receptionist approval must be reviewed separately.' : action === 'approve_receptionist' ? 'Published snapshot approved for the receptionist.' : action === 'revoke_receptionist' ? 'Receptionist approval revoked.' : action === 'archive' ? 'Document archived. It is excluded from AI answers.' : 'Document unpublished. It is excluded from AI answers.') }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Unable to change publication.') }
    finally { if (mounted.current) setBusy(false) }
  }

  async function extract(file: File): Promise<void> {
    if (busy) return
    if (file.size > 2 * 1024 * 1024) { setError('Choose a file no larger than 2 MB.'); return }
    setBusy(true); setError(null); setNotice('')
    try {
      const form = new FormData(); form.append('file', file)
      const result = await responseData<{ contentText: string; sourceName: string; sourceMime: string; warnings: string[] }>(await fetch('/api/knowledge/extract', { method: 'POST', body: form }))
      if (mounted.current) {
        setDraft(current => ({ ...current, contentText: result.contentText, sourceName: result.sourceName, sourceMime: result.sourceMime, title: current.title || result.sourceName.replace(/\.[^.]+$/, '').slice(0, 160) }))
        setDirty(true); setWarnings(result.warnings); setNotice('Text extracted for review. Save the draft, then publish it when ready.')
      }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Unable to extract this file.') }
    finally { if (mounted.current) setBusy(false) }
  }

  const archived = Boolean(selected?.archivedAt)
  const published = Boolean(selected?.publishedAt && selected.publishedRevision !== null)
  const approved = published && selected?.receptionistApprovedRevision === selected?.publishedRevision
  const unpublishedChanges = published && selected && (draft.title !== selected.publishedTitle || draft.category !== selected.publishedCategory || draft.contentText !== selected.publishedText)

  return <div className="flex min-w-0 flex-col gap-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow text-muted-foreground">Business reference</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Knowledge library</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review business information before publishing it for Airish. Public receptionist access needs a separate approval.</p></div><div className="flex gap-2"><Button type="button" variant="outline" disabled={loading || busy} onClick={() => void navigate('reload')}><RefreshCw className="mr-2 size-4" aria-hidden="true" />Reload</Button><Button type="button" disabled={loading || busy} onClick={() => void navigate('new')}><Plus className="mr-2 size-4" aria-hidden="true" />New document</Button></div></header>
    {error && <p role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand">{notice}</p>}
    {navigation && <section aria-label="Unsaved draft confirmation" className="rounded-lg border bg-card p-4"><p className="text-sm">You have unsaved edits. Discard them to continue?</p><div className="mt-3 flex gap-2"><Button type="button" variant="outline" onClick={() => setNavigation(null)}>Keep editing</Button><Button type="button" onClick={() => void navigate(navigation, true)}>Discard and continue</Button></div></section>}
    <div className="grid min-w-0 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]"><aside aria-label="Knowledge documents" className="min-w-0 rounded-xl border bg-card p-3">{loading ? <p role="status" className="p-4 text-sm text-muted-foreground">Loading knowledge…</p> : documents.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No documents yet. Add pricing, services, or FAQs to get started.</p> : <ul className="grid gap-2">{documents.map(document => <li key={document.id}><button type="button" aria-label={document.title} aria-pressed={selected?.id === document.id} disabled={busy} onClick={() => void navigate(document.id)} className={`w-full min-w-0 rounded-lg border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === document.id ? 'border-brand bg-brand/5' : 'hover:bg-muted'}`}><span className="block break-words text-sm font-medium">{document.title}</span><span className="mt-1 block text-xs text-muted-foreground">{document.category} · {document.archivedAt ? 'Archived' : document.publishedAt ? 'Published' : 'Draft'}</span>{document.publishedAt && !document.archivedAt && <span className="mt-1 block text-xs text-muted-foreground">{document.receptionistApprovedRevision === document.publishedRevision ? 'Public receptionist approved' : 'Airish only'}</span>}</button></li>)}</ul>}</aside>
    {editing ? <section aria-label="Knowledge editor" className="min-w-0 rounded-xl border bg-card p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{archived ? 'Archived document' : selected ? 'Edit draft' : 'New draft'}</h2><span className="text-xs text-muted-foreground">{selected ? `Draft revision ${selected.revision}` : 'Not saved yet'}</span></div>
      {unpublishedChanges && <p className="mt-3 rounded-md bg-muted p-3 text-sm">Unpublished changes. Airish and the receptionist continue using the published snapshot.</p>}
      <div className="mt-4 grid gap-4"><label className="grid gap-1.5 text-sm font-medium">Document title<input className={field} value={draft.title} maxLength={160} disabled={busy || archived} onChange={event => change({ title: event.target.value })} /></label><label className="grid gap-1.5 text-sm font-medium">Category<select className={field} value={draft.category} disabled={busy || archived} onChange={event => change({ category: event.target.value as Category })}>{categories.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
      {!archived && <div className="rounded-lg border border-dashed p-3"><label className="grid gap-2 text-sm font-medium"><span className="flex items-center gap-2"><FileUp className="size-4" aria-hidden="true" />Upload document</span><input type="file" aria-label="Upload document" accept=".txt,.md,.csv,.pdf,.docx,text/plain,text/markdown,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void extract(file) }} /></label><p className="mt-2 text-xs text-muted-foreground">TXT, Markdown, CSV, PDF or DOCX · 2 MB maximum. A successful upload replaces the draft text for review. Original files are not retained. Scanned PDFs need OCR elsewhere.</p></div>}
      {draft.sourceName && <p className="break-words text-xs text-muted-foreground">Source: {draft.sourceName}</p>}{warnings.map((warning, index) => <p key={index} className="text-sm text-muted-foreground">{warning}</p>)}<label className="grid gap-1.5 text-sm font-medium">Document text<textarea className={`${field} min-h-64`} rows={14} maxLength={100000} value={draft.contentText} disabled={busy || archived} onChange={event => change({ contentText: event.target.value })} /></label>
      {!archived && <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !draft.title.trim() || !draft.contentText.trim()} onClick={() => void save()}>Save draft</Button><Button type="button" variant="outline" disabled={busy || dirty || !selected} onClick={() => void transition('publish')}>Publish for Airish</Button>{published && <Button type="button" variant="outline" disabled={busy} onClick={() => void transition('unpublish')}>Unpublish</Button>}<Button type="button" variant="outline" disabled={busy || dirty || !selected} onClick={() => void transition('archive')}>Archive</Button></div>}
      {dirty && !archived && <p className="text-xs text-muted-foreground">Save or discard your edits before publishing or archiving.</p>}
      </div>
      {published && selected && <section aria-label="Published snapshot" className="mt-6 min-w-0 rounded-lg border p-4"><h3 className="text-sm font-semibold">Published revision {selected.publishedRevision}</h3><p className="mt-1 break-words text-sm font-medium">{selected.publishedTitle}</p><p className="mt-1 text-xs text-muted-foreground">{selected.publishedCategory}</p><p className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-sm">{selected.publishedText}</p>{approved ? <div className="mt-4"><p className="text-sm text-brand">Receptionist approved · revision {selected.publishedRevision}</p>{!archived && <Button type="button" className="mt-2" variant="outline" disabled={busy} onClick={() => void transition('revoke_receptionist')}>Revoke receptionist approval</Button>}</div> : !archived ? <div className="mt-4 grid gap-3"><label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.target.checked)} />I reviewed the published snapshot above and approve this revision for callers to the public AI receptionist.</label><Button type="button" className="w-fit" disabled={busy || !acknowledged} onClick={() => void transition('approve_receptionist')}>Approve for receptionist</Button></div> : null}</section>}
    </section> : <section className="flex min-w-0 flex-col items-center justify-center rounded-xl border border-dashed p-10 text-center"><BookOpen className="mb-3 size-8 text-muted-foreground" aria-hidden="true" /><h2 className="font-medium">Choose a document to review</h2><p className="mt-2 max-w-sm text-sm text-muted-foreground">Publish reviewed text for Airish. Each publication clears its public receptionist approval.</p></section>}
    </div>
  </div>
}
