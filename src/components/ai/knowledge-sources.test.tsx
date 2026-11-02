import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KnowledgeSources } from './knowledge-sources'

describe('Airish knowledge sources', () => {
  it('renders source titles and revisions as text without exposing IDs or creating links', () => {
    render(<KnowledgeSources sources={[{ id: 'private-source-id', title: '<img src=x onerror=alert(1)> [link](javascript:alert(1))', revision: 3, category: 'PRICING' }]} />)
    expect(screen.getByLabelText('Knowledge references')).toHaveTextContent('<img src=x onerror=alert(1)>')
    expect(screen.getByLabelText('Knowledge references')).toHaveTextContent('revision 3')
    expect(screen.queryByText('private-source-id')).not.toBeInTheDocument()
    expect(document.querySelectorAll('img,a,script')).toHaveLength(0)
  })
  it('does not add an empty references box for ordinary CRM answers', () => {
    render(<KnowledgeSources sources={[]} />)
    expect(screen.queryByLabelText('Knowledge references')).not.toBeInTheDocument()
  })
})
