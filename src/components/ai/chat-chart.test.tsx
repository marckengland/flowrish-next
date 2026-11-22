import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AiChart } from '@/lib/ai-chart'
import { ChatChart } from './chat-chart'
import { ChatMessage } from './chat-message'

const sample: AiChart = {
  type: 'bar', title: 'Provided pipeline', unit: 'deals',
  data: [
    { label: 'Qualified', value: 2, details: { columns: ['Name', 'Next step'], rows: [['Maya Demo', 'Review outline'], ['Luis Example', 'Retry call']] } },
    { label: 'Won', value: 1 },
  ],
}
const selectQualified = () => fireEvent.click(screen.getByRole('button', { name: 'Filter to Qualified, 2 deals, point 1 of 2' }))
const dataTable = () => screen.getByRole('table', { name: 'Provided pipeline data' })

describe('Interactive AI charts', () => {
  it.each(['bar', 'line'] as const)('filters the %s value table and resets without changing figures', type => {
    render(<ChatChart chart={{ ...sample, type }} />)
    const point = screen.getByRole('button', { name: 'Filter to Qualified, 2 deals, point 1 of 2' })
    expect(point.tagName).toBe('BUTTON')
    expect(point).toHaveAttribute('type', 'button')
    expect(point).toHaveAttribute('aria-pressed', 'false')
    expect(within(dataTable()).getAllByRole('row')).toHaveLength(3)
    selectQualified()
    expect(point).toHaveAttribute('aria-pressed', 'true')
    expect(within(dataTable()).getAllByRole('row')).toHaveLength(2)
    expect(within(dataTable()).getByRole('cell', { name: 'Qualified' })).toBeVisible()
    expect(within(dataTable()).queryByRole('cell', { name: 'Won' })).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Showing Qualified')
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
    expect(within(dataTable()).getAllByRole('row')).toHaveLength(3)
    expect(point).toHaveAttribute('aria-pressed', 'false')
    expect(within(within(dataTable()).getAllByRole('row')[1]).getAllByRole('cell')[2]).toHaveTextContent('2')
  })

  it('opens only supplied detail rows and closes them on a new selection', () => {
    render(<ChatChart chart={sample} />)
    expect(screen.queryByText('Maya Demo')).toBeNull()
    selectQualified()
    fireEvent.click(screen.getByRole('button', { name: 'View details for Qualified' }))
    const table = screen.getByRole('table', { name: 'Qualified supplied rows' })
    expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Name', 'Next step'])
    expect(within(table).getByRole('cell', { name: 'Maya Demo' })).toBeVisible()
    expect(within(table).getAllByRole('row')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Filter to Won, 1 deals, point 2 of 2' }))
    expect(screen.queryByText('Maya Demo')).toBeNull()
    expect(screen.queryByRole('button', { name: /View details/ })).toBeNull()
    expect(screen.getByText(/No underlying rows were supplied for Won/)).toBeVisible()
  })

  it('selects from category rows and toggles the same selection back to all', () => {
    render(<ChatChart chart={sample} />)
    fireEvent.click(within(dataTable()).getByRole('button', { name: 'Qualified' }))
    expect(within(dataTable()).getAllByRole('row')).toHaveLength(2)
    fireEvent.click(within(dataTable()).getByRole('button', { name: 'Qualified' }))
    expect(within(dataTable()).getAllByRole('row')).toHaveLength(3)
  })

  it('resets stale selection and details when the supplied chart changes', () => {
    const { rerender } = render(<ChatChart chart={sample} />)
    selectQualified()
    fireEvent.click(screen.getByRole('button', { name: 'View details for Qualified' }))
    const changed: AiChart = { ...sample, data: [{ label: 'Qualified', value: 3, details: { columns: ['Name'], rows: [['Nina Trial']] } }, sample.data[1]] }
    rerender(<ChatChart chart={changed} />)
    expect(screen.queryByText('Maya Demo')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('All 2 categories')
    expect(screen.queryByRole('button', { name: /View details/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Filter to Qualified, 3 deals, point 1 of 2' }))
    fireEvent.click(screen.getByRole('button', { name: 'View details for Qualified' }))
    expect(screen.getByRole('cell', { name: 'Nina Trial' })).toBeVisible()
  })

  it('retains selection on equal-data rerenders and keeps charts independent', () => {
    const ui = (chart: AiChart) => <><div data-testid="first"><ChatChart chart={chart} /></div><div data-testid="second"><ChatChart chart={{ ...sample, title: 'Other pipeline' }} /></div></>
    const { rerender } = render(ui(sample))
    const first = within(screen.getByTestId('first')), second = within(screen.getByTestId('second'))
    fireEvent.click(first.getByRole('button', { name: 'Qualified' }))
    fireEvent.click(first.getByRole('button', { name: 'View details for Qualified' }))
    rerender(ui(structuredClone(sample)))
    expect(first.getByRole('cell', { name: 'Maya Demo' })).toBeVisible()
    expect(second.getByRole('status')).toHaveTextContent('All 2 categories')
    expect(second.queryByText('Maya Demo')).toBeNull()
  })

  it('distinguishes duplicate labels and permits zero and negative point selection', () => {
    const { container } = render(<ChatChart chart={{ ...sample, data: [{ label: 'Same', value: 0 }, { label: 'Same', value: -2.5 }] }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filter to Same, -2.5 deals, point 2 of 2' }))
    expect(within(dataTable()).getAllByRole('row')).toHaveLength(2)
    expect(within(dataTable()).getAllByRole('cell')[2]).toHaveTextContent('-2.5')
    fireEvent.click(screen.getByRole('button', { name: 'Filter to Same, 0 deals, point 1 of 2' }))
    expect(within(dataTable()).getAllByRole('cell')[2]).toHaveTextContent('0')
    expect(container.querySelector('svg')?.outerHTML).not.toMatch(/NaN|Infinity/)
  })

  it('renders detail text without links, scripts, record actions, or network requests', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    const payload = { ...sample, data: [{ ...sample.data[0], details: { columns: ['Note'], rows: [['<img src=x onerror=alert(1)>'], ['javascript:alert(1)']] } }, sample.data[1]] }
    const { container } = render(<ChatChart chart={payload} />)
    selectQualified(); fireEvent.click(screen.getByRole('button', { name: 'View details for Qualified' }))
    expect(screen.getByRole('cell', { name: '<img src=x onerror=alert(1)>' })).toBeVisible()
    expect(screen.getByRole('cell', { name: 'javascript:alert(1)' })).toBeVisible()
    expect(container.querySelectorAll('a, script, iframe, img')).toHaveLength(0)
    expect(fetch).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('keeps malformed and oversized supplied detail payloads inert in chat messages', () => {
    const { container, rerender } = render(<ChatMessage source={'```chart\n' + JSON.stringify({ ...sample, data: [{ label: 'Qualified', value: 2, details: { columns: ['Name'], rows: [['Maya', 'extra']] } }] }) + '\n```'} />)
    expect(screen.getByText(/Chart unavailable/)).toBeVisible()
    expect(container.querySelector('svg')).toBeNull()
    const large = { ...sample, data: Array.from({ length: 12 }, () => ({ label: 'Q', value: 20, details: { columns: ['Name'], rows: Array(20).fill(['x'.repeat(160)]) } })) }
    rerender(<ChatMessage source={'```chart\n' + JSON.stringify(large) + '\n```'} />)
    expect(screen.getByText(/Chart unavailable/)).toBeVisible()
    expect(container.querySelector('svg')).toBeNull()
  })
})
