import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChatMessage } from './chat-message'

const chart = (value: unknown) => '```chart\n' + JSON.stringify(value) + '\n```'
const sample = { type: 'bar', title: 'Provided pipeline', unit: 'deals', data: [{ label: 'Qualified', value: 12 }, { label: 'Won', value: 4 }] }

describe('Airish answer presentation', () => {
  it('shows the answer once when source references are displayed separately, retaining history provenance', () => {
    const source = 'Our team will confirm pricing.\n\nKnowledge sources:\n[K1] Approved guidance (revision 1)'
    const { rerender } = render(<ChatMessage source={source} hasSourceReferences />)
    expect(screen.getByText('Our team will confirm pricing.')).toBeVisible()
    expect(screen.queryByText(/Knowledge sources:/)).toBeNull()
    rerender(<ChatMessage source={source} />)
    expect(screen.getByText(/Knowledge sources:/)).toBeVisible()
    expect(source).toContain('[K1] Approved guidance (revision 1)')
  })
  it('retains headings, lists, safe links, inline formatting and escaped code', () => {
    const { container } = render(<ChatMessage source={'## Next step\n\n**Call** the `owner`.\n\n- One\n- Two\n\n1. Review\n2. Confirm\n\n[Guide](https://example.com)\n\n```text\n<script>alert(1)</script>\n```'} />)
    expect(screen.getByRole('heading', { name: 'Next step' })).toBeVisible()
    expect(screen.getAllByRole('list')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Guide' })).toHaveAttribute('rel', 'noopener noreferrer')
    expect(container.querySelector('strong')).toHaveTextContent('Call')
    expect(container.querySelector('pre code')).toHaveTextContent('<script>alert(1)</script>')
    expect(container.querySelector('script')).toBeNull()
  })
  it('renders comparison data as a real table with scoped column headers', () => {
    render(<ChatMessage source={'Qualified has the most deals.\n\n| Stage | Deals |\n| --- | ---: |\n| Qualified | 12 |\n| Won | 4 |\n\nFollow up with qualified leads.'} />)
    const table = screen.getByRole('table')
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Stage', 'Deals'])
    expect(within(table).getByRole('cell', { name: '12' })).toBeVisible()
    expect(within(table).getAllByRole('columnheader').every(cell => cell.getAttribute('scope') === 'col')).toBe(true)
    expect(screen.getByText('Follow up with qualified leads.')).toBeVisible()
  })
  it.each(['bar', 'line'])('renders a %s chart with an accessible exact-value table', type => {
    render(<ChatMessage source={'Qualified leads are the largest group.\n\n' + chart({ ...sample, type })} />)
    expect(screen.getByRole('img', { name: 'Provided pipeline' })).toBeVisible()
    expect(screen.getByText('Qualified leads are the largest group.')).toBeVisible()
    const table = screen.getByRole('table', { name: 'Provided pipeline data' })
    expect(within(table).getByRole('cell', { name: '12' })).toBeVisible()
    expect(within(table).getByRole('cell', { name: 'Won' })).toBeVisible()
  })
  it('does not interpret chart syntax within another fenced code block', () => {
    const { container } = render(<ChatMessage source={'````text\n' + chart(sample) + '\n````'} />)
    expect(container.querySelector('svg')).toBeNull()
  })
  it.each([
    { ...sample, type: 'html' },
    { ...sample, data: [{ label: 'Missing', value: null }] },
    { ...sample, data: Array.from({ length: 13 }, (_, i) => ({ label: String(i), value: i })) },
    { ...sample, data: [{ label: 'Huge', value: 1e99 }] },
    { ...sample, script: 'alert(1)' },
  ])('keeps malformed or unsupported charts from producing a misleading graphic', value => {
    const { container } = render(<ChatMessage source={'Keep this explanation.\n\n' + chart(value)} />)
    expect(screen.getByText('Keep this explanation.')).toBeVisible()
    expect(screen.getByText(/Chart unavailable/)).toBeVisible()
    expect(container.querySelector('svg')).toBeNull()
  })
  it('keeps incomplete streaming charts quiet until the closing fence arrives', () => {
    const { container, rerender } = render(<ChatMessage streaming source={'The supplied figures show:\n\n```chart\n{"type":"bar"'} />)
    expect(screen.getByText('Preparing chart…')).toBeVisible()
    expect(container.querySelector('svg')).toBeNull()
    rerender(<ChatMessage source={'The supplied figures show:\n\n' + chart(sample)} />)
    expect(screen.queryByText('Preparing chart…')).toBeNull()
    expect(screen.getByRole('img', { name: 'Provided pipeline' })).toBeVisible()
  })
  it('shows an honest fallback when a finished reply has an unclosed chart', () => {
    render(<ChatMessage source={'The answer was cut short.\n\n```chart\n{"type":"bar"'} />)
    expect(screen.getByText(/Chart unavailable/)).toBeVisible()
    expect(screen.queryByText('Preparing chart…')).toBeNull()
  })
  it('escapes model-provided HTML in table cells, chart labels and titles', () => {
    const { container } = render(<ChatMessage source={'| Stage | Deals |\n| --- | --- |\n| <img src=x onerror=alert(1)> | 12 |\n\n' + chart({ ...sample, title: '<script>bad()</script>', data: [{ label: '<img src=x onerror=alert(1)>', value: 12 }] })} />)
    expect(container.querySelectorAll('img, script, iframe')).toHaveLength(0)
    expect(screen.getByRole('img', { name: '<script>bad()</script>' })).toBeVisible()
  })
  it.each([[0, 0], [-5, 12], [-5, -2], [0.005, 0.01]])('plots valid zero, signed and fractional data without invalid coordinates: %j', (a, b) => {
    const { container } = render(<ChatMessage source={chart({ ...sample, data: [{ label: 'A', value: a }, { label: 'B', value: b }] })} />)
    expect(screen.getByRole('img', { name: 'Provided pipeline' })).toBeVisible()
    expect(container.querySelector('svg')?.outerHTML).not.toMatch(/NaN|Infinity/)
  })
})
