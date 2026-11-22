import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/components/activities/activity-timeline', () => ({ ActivityTimeline: () => <p>Timeline</p> }))
vi.mock('@/components/activities/activity-form', () => ({ ActivityForm: () => <input aria-label="Activity notes" /> }))
vi.mock('@/components/activities/file-upload', () => ({ FileUpload: () => null }))
vi.mock('@/components/admin/audit-log-table', () => ({ AuditLogTable: () => <p>Audit history</p> }))
vi.mock('@/components/email/email-compose', () => ({
  EmailCompose: function Draft() {
    const [subject, setSubject] = useState('')
    return <input aria-label="Draft subject" value={subject} onChange={event => setSubject(event.target.value)} />
  },
}))
vi.mock('./lead-emails', () => ({
  EmailsTab: ({ canWrite }: { canWrite: boolean }) => <section aria-label="Email history">
    <p>Linked emails</p>
    {canWrite && <input aria-label="Reply draft" />}
  </section>,
}))

import { LeadTabs, type LeadTabsProps } from './lead-tabs'

const props: LeadTabsProps = {
  leadId: 'sample-lead', leadName: 'Sam Sample', leadEmail: 'sam@example.invalid',
  initialActivities: [], contacts: [], canWrite: true,
}
const open = (name: string) => fireEvent.click(screen.getByRole('tab', { name }))

describe('Lead tab drafts', () => {
  it('preserves email and activity edits across tab switches without eagerly mounting email history', () => {
    render(<LeadTabs {...props} />)
    expect(screen.queryByText('Linked emails')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Draft subject'), { target: { value: 'Reviewed first contact' } })
    fireEvent.change(screen.getByLabelText('Activity notes'), { target: { value: 'Call notes in progress' } })
    open('Emails')
    expect(screen.getByLabelText('Draft subject')).not.toBeVisible()
    fireEvent.change(screen.getByLabelText('Reply draft'), { target: { value: 'Reviewed reply' } })
    open('Audit log')
    expect(screen.getByLabelText('Reply draft')).not.toBeVisible()
    open('Activities')
    expect(screen.getByLabelText('Draft subject')).toHaveValue('Reviewed first contact')
    expect(screen.getByLabelText('Activity notes')).toHaveValue('Call notes in progress')
    open('Emails')
    expect(screen.getByLabelText('Reply draft')).toBeVisible()
    expect(screen.getByLabelText('Reply draft')).toHaveValue('Reviewed reply')
  })

  it('clears retained drafts and the selected tab when the lead changes', () => {
    const { rerender } = render(<LeadTabs {...props} />)
    fireEvent.change(screen.getByLabelText('Draft subject'), { target: { value: 'For Sam only' } })
    open('Emails')
    fireEvent.change(screen.getByLabelText('Reply draft'), { target: { value: 'Private reply for Sam' } })
    rerender(<LeadTabs {...props} leadId="other-lead" leadName="Other Prospect" />)
    expect(screen.getByRole('tab', { name: 'Activities' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Draft subject')).toHaveValue('')
    expect(screen.queryByText('Linked emails')).not.toBeInTheDocument()
    open('Emails')
    expect(screen.getByLabelText('Reply draft')).toHaveValue('')
  })

  it('removes write controls from retained panes when permission is revoked', () => {
    const { rerender } = render(<LeadTabs {...props} />)
    fireEvent.change(screen.getByLabelText('Draft subject'), { target: { value: 'Private draft' } })
    open('Emails')
    fireEvent.change(screen.getByLabelText('Reply draft'), { target: { value: 'Private reply' } })
    open('Audit log')
    rerender(<LeadTabs {...props} canWrite={false} />)
    open('Activities')
    expect(screen.queryByLabelText('Draft subject')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Activity notes')).not.toBeInTheDocument()
    open('Emails')
    expect(screen.queryByLabelText('Reply draft')).not.toBeInTheDocument()
    expect(screen.getByText('Linked emails')).toBeVisible()
  })
})
