import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeGapsInbox } from './knowledge-gaps-inbox'

const key = 'a'.repeat(64)
const version = 'b'.repeat(64)
const rehearsalId = '39a92f81-0c90-4bf3-971d-1ce39ca77b20'
const documentId = '49a92f81-0c90-4bf3-971d-1ce39ca77b20'
const group = { key, version, question: 'Do you offer weekend appointments?', occurrenceCount: 3, latestAt: '2026-11-03T00:00:00.000Z', status: 'open', changedSinceResolution: false, faqCounts: { draft: 1, published: 0, approved: 0, archived: 1 }, resolution: null }
const occurrence = { rehearsalId, title: 'Weekend check', messageIndex: 0, updatedAt: group.latestAt, rehearsalUrl: `/settings?section=receptionist&rehearsal=${rehearsalId}`, faq: { documentId, title: 'Weekend FAQ', status: 'draft', knowledgeUrl: `/knowledge?document=${documentId}` } }
const list = { groups: [group], page: 1, pageSize: 20, hasMore: false }
const detail = { group, occurrences: [occurrence], page: 1, pageSize: 20, hasMore: false }
const ok = (data: unknown) => ({ ok: true, json: async () => ({ data }) })
const failed = (status: number, code = 'PRIVATE_SERVER_DETAIL') => ({ ok: false, status, json: async () => ({ error: { code, message: 'private database details' } }) })
async function openQuestion() {
  fireEvent.click(screen.getByRole('button', { name: 'Load knowledge gaps' }))
  fireEvent.click(await screen.findByRole('button', { name: `Open question: ${group.question}` }))
  await screen.findByLabelText('Resolution notes')
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('knowledge gaps inbox', () => {
  it('loads only on request and shows grouped counts, validated source links, and occurrence pages', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok({ ...list, hasMore: true })).mockResolvedValueOnce(ok({ ...detail, hasMore: true })).mockResolvedValueOnce(ok({ ...detail, page: 2, occurrences: [] }))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    expect(request).not.toHaveBeenCalled()
    await openQuestion()
    expect(request.mock.calls[0][0]).toBe('/api/admin/receptionist/knowledge-gaps?status=open&page=1')
    expect(screen.getByText('3 occurrences')).toBeInTheDocument()
    expect(screen.getAllByText(/1 draft.*0 published.*0 approved.*1 archived/).length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: 'Weekend check' })).toHaveAttribute('href', occurrence.rehearsalUrl)
    expect(screen.getByRole('link', { name: 'Weekend FAQ (draft)' })).toHaveAttribute('href', occurrence.faq.knowledgeUrl)
    fireEvent.click(screen.getByRole('button', { name: 'Next occurrences' }))
    await waitFor(() => expect(request.mock.calls[2][0]).toBe(`/api/admin/receptionist/knowledge-gaps/${key}?page=2`))
    expect(await screen.findByText('Occurrences page 2')).toBeInTheDocument()
  })

  it('requires a manual retest, resolves with the current version, removes resolved open rows and reopens explicitly', async () => {
    const resolved = { ...group, version: 'c'.repeat(64), status: 'resolved', resolution: { notes: 'Verified the new answer', resolvedAt: group.latestAt } }
    const request = vi.fn().mockResolvedValueOnce(ok(list)).mockResolvedValueOnce(ok(detail)).mockResolvedValueOnce(ok({ ...detail, group: resolved })).mockResolvedValueOnce(ok({ ...list, groups: [] })).mockResolvedValueOnce(ok({ ...detail, group: { ...group, version: 'd'.repeat(64) } })).mockResolvedValueOnce(ok(list))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    expect(screen.getByRole('button', { name: 'Resolve gap' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Verified the new answer' } })
    fireEvent.click(screen.getByLabelText('I manually retested this question'))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve gap' }))
    expect(await screen.findByRole('button', { name: 'Reopen gap' })).toBeEnabled()
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ expectedVersion: version, action: 'resolve', retested: true, notes: 'Verified the new answer' })
    expect(screen.queryByRole('button', { name: `Open question: ${group.question}` })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reopen gap' }))
    await screen.findByRole('button', { name: 'Resolve gap' })
    expect(JSON.parse(request.mock.calls[4][1].body)).toEqual({ expectedVersion: resolved.version, action: 'reopen', retested: false, notes: 'Verified the new answer' })
  })

  it('refills the current group page after resolution before advancing the server offset', async () => {
    const remaining = Array.from({ length: 21 }, (_, index) => ({ ...group, key: (index + 1).toString(16).padStart(64, '0'), question: `Question ${index + 2}` }))
    const initialPage = { ...list, groups: [group, ...remaining.slice(0, 19)], hasMore: true }
    const resolved = { ...group, version: 'c'.repeat(64), status: 'resolved', resolution: { notes: '', resolvedAt: group.latestAt } }
    let refresh!: (value: unknown) => void
    const request = vi.fn().mockResolvedValueOnce(ok(initialPage)).mockResolvedValueOnce(ok(detail)).mockResolvedValueOnce(ok({ ...detail, group: resolved })).mockImplementationOnce(() => new Promise(resolve => { refresh = resolve })).mockResolvedValueOnce(ok({ ...list, groups: remaining.slice(20), page: 2 }))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    fireEvent.click(screen.getByLabelText('I manually retested this question'))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve gap' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(4))
    expect(request.mock.calls[3][0]).toBe('/api/admin/receptionist/knowledge-gaps?status=open&page=1')
    expect(screen.getByRole('button', { name: 'Next questions' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reopen gap' })).toBeDisabled()
    expect(request.mock.calls[3][1].signal).toBe(request.mock.calls[2][1].signal)
    await act(async () => { refresh(ok({ ...list, groups: remaining.slice(0, 20), hasMore: true })) })
    expect(screen.getAllByRole('button', { name: /^Open question:/ })).toHaveLength(20)
    expect(screen.getByRole('button', { name: 'Open question: Question 21' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reopen gap' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Next questions' }))
    expect(await screen.findByRole('button', { name: 'Open question: Question 22' })).toBeInTheDocument()
    expect(request.mock.calls[4][0]).toBe('/api/admin/receptionist/knowledge-gaps?status=open&page=2')
  })

  it('keeps mutation success but clears unsafe paging when refreshing the group page fails', async () => {
    const resolved = { ...group, version: 'c'.repeat(64), status: 'resolved', resolution: { notes: 'Saved notes', resolvedAt: group.latestAt } }
    const request = vi.fn().mockResolvedValueOnce(ok({ ...list, hasMore: true })).mockResolvedValueOnce(ok(detail)).mockResolvedValueOnce(ok({ ...detail, group: resolved })).mockResolvedValueOnce(failed(500)).mockResolvedValueOnce(ok({ ...list, groups: [] }))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Saved notes' } })
    fireEvent.click(screen.getByLabelText('I manually retested this question'))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve gap' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/saved.*load knowledge gaps.*paging/i)
    expect(screen.getByText(/gap resolved after your manual retest/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('Saved notes')
    expect(screen.getByRole('button', { name: 'Reopen gap' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Next questions' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load knowledge gaps' }))
    expect(await screen.findByText('No open knowledge gaps on this page.')).toBeInTheDocument()
  })

  it.each(['resolved', 'reordered'] as const)('invalidates paging when loading a question reveals an externally %s group version', async change => {
    const rest = Array.from({ length: 19 }, (_, index) => ({ ...group, key: (index + 1).toString(16).padStart(64, '0'), question: `Other question ${index + 1}` }))
    const changed = { ...group, version: 'c'.repeat(64), latestAt: '2026-11-03T01:00:00.000Z', status: change === 'resolved' ? 'resolved' : 'open', resolution: { notes: 'Saved review notes', resolvedAt: change === 'resolved' ? group.latestAt : null } }
    const request = vi.fn().mockResolvedValueOnce(ok({ ...list, groups: [group, ...rest], hasMore: true })).mockResolvedValueOnce(ok({ ...detail, group: changed })).mockResolvedValueOnce(ok({ ...list, groups: change === 'resolved' ? rest : [changed, ...rest] }))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    expect(screen.getByText(/question changed.*load knowledge gaps.*paging/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next questions' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Open question:/ })).not.toBeInTheDocument()
    expect(screen.getByText(`Review: ${group.question}`)).toBeInTheDocument()
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('Saved review notes')
    expect(screen.getByText(`Gap status: ${changed.status === 'resolved' ? 'Resolved' : 'Open'}`)).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Load knowledge gaps' }))
    expect(await screen.findByRole('button', { name: 'Open question: Other question 1' })).toBeInTheDocument()
    expect(request.mock.calls[2][0]).toBe('/api/admin/receptionist/knowledge-gaps?status=open&page=1')
  })

  it('keeps a confirmed FAQ save and local notes when its refresh fails, blocks writes, and recovers on explicit reload', async () => {
    const resolved = { ...group, status: 'resolved', faqCounts: { draft: 0, published: 0, approved: 0, archived: 0 }, resolution: { notes: 'Earlier review', resolvedAt: group.latestAt } }
    const reopened = { ...group, version: 'c'.repeat(64), changedSinceResolution: true, resolution: resolved.resolution }
    const request = vi.fn().mockResolvedValueOnce(ok({ ...list, groups: [resolved], hasMore: true })).mockResolvedValueOnce(ok({ ...detail, group: resolved, occurrences: [] })).mockResolvedValueOnce(ok({ documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: true })).mockResolvedValueOnce(failed(500)).mockResolvedValueOnce(failed(500)).mockResolvedValueOnce(ok({ ...detail, group: reopened }))
    vi.stubGlobal('fetch', request)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Keep my local review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create or open FAQ draft' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/FAQ draft was saved.*reload latest question/i)
    expect(screen.getByRole('link', { name: 'Open FAQ draft' })).toHaveAttribute('href', `/knowledge?document=${documentId}`)
    expect(screen.getByText(/FAQ draft created.*write and review/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('Keep my local review')
    expect(screen.queryByRole('button', { name: 'Next questions' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reopen gap' })).toBeDisabled()
    expect(screen.queryByText(/could not save this action/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest question' }))
    await waitFor(() => expect(request).toHaveBeenCalledTimes(5))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload latest question' })).toBeEnabled())
    expect(screen.getByRole('link', { name: 'Open FAQ draft' })).toHaveAttribute('href', `/knowledge?document=${documentId}`)
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('Keep my local review')
    expect(screen.getByRole('button', { name: 'Reopen gap' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest question' }))
    expect(await screen.findByRole('button', { name: 'Resolve gap' })).toBeDisabled()
    expect(screen.getByLabelText('I manually retested this question')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('I manually retested this question'))
    expect(screen.getByRole('button', { name: 'Resolve gap' })).toBeEnabled()
    expect(request.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1)
    expect(request.mock.calls[4][0]).toBe(`/api/admin/receptionist/knowledge-gaps/${key}?page=1`)
    expect(request.mock.calls[5][0]).toBe(`/api/admin/receptionist/knowledge-gaps/${key}?page=1`)
  })

  it('preserves local edits on conflict and requires explicit confirmation before replacing them', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok(list)).mockResolvedValueOnce(ok(detail)).mockResolvedValueOnce(failed(409)).mockResolvedValueOnce(ok({ ...detail, group: { ...group, version: 'c'.repeat(64), changedSinceResolution: true } }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Keep this note' } })
    fireEvent.click(screen.getByLabelText('I manually retested this question'))
    fireEvent.click(screen.getByRole('button', { name: 'Resolve gap' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('Keep this note')
    expect(screen.getByLabelText('I manually retested this question')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest question' }))
    expect(request).toHaveBeenCalledTimes(3)
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest question' }))
    await waitFor(() => expect(screen.getByLabelText('Resolution notes')).toHaveValue(''))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/source changes or new flags reopen/i)).toBeInTheDocument()
  })

  it('blocks discarding dirty edits on filter, pagination, question selection and links', async () => {
    const second = { ...group, key: 'e'.repeat(64), question: 'Another question' }
    const request = vi.fn().mockResolvedValueOnce(ok({ ...list, groups: [group, second], hasMore: true })).mockResolvedValueOnce(ok({ ...detail, hasMore: true }))
    vi.stubGlobal('fetch', request)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Unsaved' } })
    fireEvent.change(screen.getByLabelText('Knowledge gap status'), { target: { value: 'all' } })
    fireEvent.click(screen.getByRole('button', { name: 'Next questions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next occurrences' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open question: Another question' }))
    fireEvent.click(screen.getByRole('link', { name: 'Weekend FAQ (draft)' }))
    expect(request).toHaveBeenCalledTimes(2)
    expect(screen.getByLabelText('Knowledge gap status')).toHaveValue('open')
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('Unsaved')
    expect(confirm).toHaveBeenCalledTimes(5)
  })

  it('protects dirty edits before a settings tab unmounts the inbox and ignores the current tab', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok(list)).mockResolvedValueOnce(ok(detail))
    vi.stubGlobal('fetch', request)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    function SettingsNavigation(): React.JSX.Element {
      const [active, setActive] = useState('receptionist')
      return <><nav aria-label="Settings sections"><button type="button" aria-current={active === 'receptionist' ? 'page' : undefined} onClick={() => setActive('receptionist')}>AI receptionist</button><button type="button" aria-current={active === 'scoring' ? 'page' : undefined} onClick={() => setActive('scoring')}><span>Scoring rules</span></button></nav>{active === 'receptionist' ? <KnowledgeGapsInbox /> : <p>Scoring settings</p>}</>
    }
    render(<SettingsNavigation />)
    await openQuestion()
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Keep this review' } })
    fireEvent.click(screen.getByLabelText('I manually retested this question'))
    fireEvent.click(screen.getByRole('button', { name: 'AI receptionist' }))
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Scoring rules'))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('Keep this review')
    expect(screen.getByLabelText('I manually retested this question')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Scoring rules' }))
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('region', { name: 'Knowledge gaps' })).not.toBeInTheDocument()
    expect(screen.getByText('Scoring settings')).toBeInTheDocument()
  })

  it.each([['changed', 'c'.repeat(64), false], ['unchanged', version, true]] as const)('requires a new retest only for a %s FAQ source version and preserves local notes', async (_label, nextVersion, keepRetest) => {
    const request = vi.fn().mockResolvedValueOnce(ok(list)).mockResolvedValueOnce(ok({ ...detail, occurrences: [] })).mockResolvedValueOnce(ok({ documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: !keepRetest })).mockResolvedValueOnce(ok({ ...detail, group: { ...group, version: nextVersion } })).mockResolvedValueOnce(ok({ ...list, groups: [{ ...group, version: nextVersion }] }))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Preserve my review notes' } })
    fireEvent.click(screen.getByLabelText('I manually retested this question'))
    fireEvent.click(screen.getByRole('button', { name: 'Create or open FAQ draft' }))
    await screen.findByRole('link', { name: 'Open FAQ draft' })
    await waitFor(() => expect(screen.getByLabelText('I manually retested this question')).toBeEnabled())
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('Preserve my review notes')
    if (keepRetest) {
      expect(screen.getByLabelText('I manually retested this question')).toBeChecked()
      expect(screen.getByRole('button', { name: 'Resolve gap' })).toBeEnabled()
    } else {
      expect(screen.getByLabelText('I manually retested this question')).not.toBeChecked()
      expect(screen.getByRole('button', { name: 'Resolve gap' })).toBeDisabled()
    }
  })

  it('tells reviewers how to save notes for an already resolved gap', async () => {
    const resolved = { ...group, status: 'resolved', resolution: { notes: 'Original review', resolvedAt: group.latestAt } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ ...list, groups: [resolved] })).mockResolvedValueOnce(ok({ ...detail, group: resolved })))
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Updated review' } })
    expect(screen.getByText(/reopen the gap to save the review/i)).toBeInTheDocument()
  })

  it('creates or opens an FAQ only on click and does not publish it', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok(list)).mockResolvedValueOnce(ok({ ...detail, occurrences: [{ ...occurrence, faq: null }] })).mockResolvedValueOnce(ok({ documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: true })).mockResolvedValueOnce(ok(detail)).mockResolvedValueOnce(ok(list))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    expect(request).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('button', { name: 'Create or open FAQ draft' }))
    expect(await screen.findByRole('link', { name: 'Open FAQ draft' })).toHaveAttribute('href', `/knowledge?document=${documentId}`)
    expect(request.mock.calls[2][0]).toBe(`/api/admin/receptionist/knowledge-gaps/${key}/faq`)
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ expectedVersion: version })
    expect(request.mock.calls.filter((call) => call[1]?.method === 'POST')).toHaveLength(1)
    expect(screen.getByText(/write the answer.*publish.*approve/i)).toBeInTheDocument()
  })

  it('ignores stale list responses after a filter change and aborts on unmount', async () => {
    let finish!: (value: unknown) => void
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(ok({ ...list, groups: [] }))
    vi.stubGlobal('fetch', request)
    const { unmount } = render(<KnowledgeGapsInbox />)
    fireEvent.click(screen.getByRole('button', { name: 'Load knowledge gaps' }))
    const signal = request.mock.calls[0][1].signal
    fireEvent.change(screen.getByLabelText('Knowledge gap status'), { target: { value: 'resolved' } })
    expect(signal.aborted).toBe(true)
    await screen.findByText('No resolved knowledge gaps on this page.')
    await act(async () => { finish(ok(list)) })
    expect(screen.queryByRole('button', { name: `Open question: ${group.question}` })).not.toBeInTheDocument()
    request.mockImplementationOnce(() => new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Load knowledge gaps' }))
    unmount()
    expect(request.mock.calls[2][1].signal.aborted).toBe(true)
  })

  it('cancels a pending question when another question is selected and ignores its late response', async () => {
    const second = { ...group, key: 'e'.repeat(64), question: 'Another question' }
    let finish!: (value: unknown) => void
    const request = vi.fn().mockResolvedValueOnce(ok({ ...list, groups: [group, second] })).mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(ok({ ...detail, group: second, occurrences: [] }))
    vi.stubGlobal('fetch', request)
    const { unmount } = render(<KnowledgeGapsInbox />)
    fireEvent.click(screen.getByRole('button', { name: 'Load knowledge gaps' }))
    fireEvent.click(await screen.findByRole('button', { name: `Open question: ${group.question}` }))
    const signal = request.mock.calls[1][1].signal
    fireEvent.click(screen.getByRole('button', { name: 'Open question: Another question' }))
    expect(signal.aborted).toBe(true)
    await screen.findByText('Review: Another question')
    await act(async () => { finish(ok(detail)) })
    expect(screen.queryByText(`Review: ${group.question}`)).not.toBeInTheDocument()
    request.mockImplementationOnce(() => new Promise(() => {}))
    fireEvent.click(screen.getByRole('button', { name: 'Reload latest question' }))
    unmount()
    expect(request.mock.calls[3][1].signal.aborted).toBe(true)
  })

  it('rejects an unsafe FAQ result, keeps notes and allows an explicit retry', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok(list)).mockResolvedValueOnce(ok({ ...detail, occurrences: [] })).mockResolvedValueOnce(ok({ documentId, knowledgeUrl: '//evil.example', created: true })).mockResolvedValueOnce(ok({ documentId, knowledgeUrl: `/knowledge?document=${documentId}`, created: false })).mockResolvedValueOnce(ok(detail)).mockResolvedValueOnce(ok(list))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    fireEvent.change(screen.getByLabelText('Resolution notes'), { target: { value: 'Preserve my work' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create or open FAQ draft' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('Preserve my work')
    expect(screen.queryByRole('link', { name: 'Open FAQ draft' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create or open FAQ draft' }))
    expect(await screen.findByRole('link', { name: 'Open FAQ draft' })).toHaveAttribute('href', `/knowledge?document=${documentId}`)
    expect(screen.getByLabelText('Resolution notes')).toHaveValue('Preserve my work')
  })

  it('rejects unsafe responses and shows safe retry guidance without server details', async () => {
    const request = vi.fn().mockResolvedValueOnce(ok({ ...list, groups: [{ ...group, key: '../../unsafe' }] })).mockResolvedValueOnce(ok(list)).mockResolvedValueOnce(ok({ ...detail, occurrences: [{ ...occurrence, rehearsalUrl: 'https://evil.example' }] }))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    fireEvent.click(screen.getByRole('button', { name: 'Load knowledge gaps' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i)
    fireEvent.click(screen.getByRole('button', { name: 'Load knowledge gaps' }))
    fireEvent.click(await screen.findByRole('button', { name: `Open question: ${group.question}` }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('shows static archive guidance on the knowledge limit and prevents duplicate FAQ writes', async () => {
    let finish!: (value: unknown) => void
    const request = vi.fn().mockResolvedValueOnce(ok(list)).mockResolvedValueOnce(ok({ ...detail, occurrences: [] })).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', request)
    render(<KnowledgeGapsInbox />)
    await openQuestion()
    const button = screen.getByRole('button', { name: 'Create or open FAQ draft' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(request).toHaveBeenCalledTimes(3)
    await act(async () => { finish(failed(400, 'KNOWLEDGE_LIMIT')) })
    expect(await screen.findByRole('alert')).toHaveTextContent(/archive a document/i)
    expect(screen.queryByText(/private database/)).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Knowledge gaps' })).queryByRole('button', { name: /publish/i })).not.toBeInTheDocument()
  })
})
