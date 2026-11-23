'use client'

import { useId, useState } from 'react'
import type { AiChart } from '@/lib/ai-chart'

export function ChatChart({ chart }: { chart: AiChart }) {
  // A different answer payload must not retain another dataset's selection.
  return <InteractiveChart key={JSON.stringify(chart)} chart={chart} />
}

function InteractiveChart({ chart }: { chart: AiChart }) {
  const id = useId()
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const selected = selectedIndex === null ? undefined : chart.data[selectedIndex]
  const select = (index: number | null) => {
    setSelectedIndex(current => current === index ? null : index)
    setDetailsOpen(false)
  }
  const values = chart.data.map(point => point.value)
  const low = Math.min(0, ...values), high = Math.max(0, ...values)
  const span = high - low || 1
  const y = (value: number) => 140 - (value - low) / span * 120
  const x = (index: number) => 25 + (index + 0.5) * 270 / chart.data.length
  const baseline = y(0)
  const width = Math.min(36, 210 / chart.data.length)
  const shortValue = new Intl.NumberFormat('en', { notation: 'compact', maximumSignificantDigits: 3 })
  return <figure className="my-3 min-w-0 space-y-2 rounded-lg border bg-background p-3" aria-labelledby={id}>
    <figcaption id={id} className="font-medium">{chart.title}{chart.unit ? <span className="ml-1 font-normal text-muted-foreground">({chart.unit})</span> : null}</figcaption>
    <div className="relative">
    <svg viewBox="0 0 320 180" role="img" aria-label={chart.title} className="block h-auto w-full text-primary">
      <desc>Chart of the supplied values. Exact labels and values are in the table below.</desc>
      <line x1="20" x2="300" y1={baseline} y2={baseline} stroke="currentColor" strokeOpacity="0.35" />
      {chart.type === 'line' && <polyline points={chart.data.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />}
      {chart.data.map((point, index) => <g key={index}>
        <title>{point.label}: {point.value}{chart.unit ? ` ${chart.unit}` : ''}</title>
        <g opacity={selectedIndex !== null && selectedIndex !== index ? 0.3 : 1}>
        {chart.type === 'bar'
          ? (point.value === 0 ? <circle cx={x(index)} cy={baseline} r="2" fill="currentColor" /> : <rect x={x(index) - width / 2} y={Math.min(baseline, y(point.value))} width={width} height={Math.abs(baseline - y(point.value))} rx="2" fill="currentColor" />)
          : <circle cx={x(index)} cy={y(point.value)} r="3" fill="currentColor" />}
        </g>
        {chart.data.length <= 6 && <text x={x(index)} y={point.value >= 0 ? Math.max(12, y(point.value) - 5) : Math.min(158, y(point.value) + 12)} textAnchor="middle" fill="currentColor" className="text-foreground" fontSize="10">{shortValue.format(point.value)}</text>}
        <text x={x(index)} y="175" textAnchor="middle" fill="currentColor" className="text-foreground" fontSize="10">{index + 1}</text>
      </g>)}
    </svg>
    {chart.data.map((point, index) => {
      const label = `Filter to ${point.label}, ${point.value}${chart.unit ? ` ${chart.unit}` : ''}, point ${index + 1} of ${chart.data.length}`
      return <button
        key={index}
        type="button"
        aria-label={label}
        title={label}
        aria-pressed={selectedIndex === index}
        aria-controls={`${id}-data`}
        onClick={() => select(index)}
        className="absolute top-0 rounded hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-primary/5"
        style={{ left: `${(25 + index * 270 / chart.data.length) / 320 * 100}%`, width: `${270 / chart.data.length / 320 * 100}%`, height: `${160 / 180 * 100}%` }}
      />
    })}
    </div>
    <div className="flex items-start justify-between gap-2 text-xs">
      <p role="status" className="text-muted-foreground">{selected ? `Showing ${selected.label}. This filter applies only to this answer.` : `All ${chart.data.length} ${chart.data.length === 1 ? 'category' : 'categories'}. Select a bar or point to filter this table.`}</p>
      <button type="button" onClick={() => select(null)} className="shrink-0 rounded px-1 font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">Show all</button>
    </div>
    <div id={`${id}-data`} role="region" aria-label={`${chart.title} data`} tabIndex={0} className="max-w-full overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-ring">
      <table aria-label={`${chart.title} data`} className="w-full text-left text-xs">
        <thead><tr><th scope="col" className="py-1 pr-2 font-medium">#</th><th scope="col" className="py-1 pr-3 font-medium">Category</th><th scope="col" className="py-1 text-right font-medium">Value{chart.unit ? ` (${chart.unit})` : ''}</th></tr></thead>
        <tbody>{chart.data.map((point, index) => selectedIndex === null || selectedIndex === index ? <tr key={index} className="border-t">
          <td className="py-1 pr-2 text-muted-foreground">{index + 1}</td>
          <td className="break-words py-1 pr-3"><button type="button" aria-pressed={selectedIndex === index} aria-controls={`${id}-data`} onClick={() => select(index)} className="min-h-9 rounded text-left underline decoration-dotted underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">{point.label}</button></td>
          <td className="py-1 text-right tabular-nums">{point.value}</td>
        </tr> : null)}</tbody>
      </table>
    </div>
    {selected && (selected.details ? <div className="space-y-2 border-t pt-2 text-xs">
      <button type="button" aria-expanded={detailsOpen} aria-controls={`${id}-details`} onClick={() => setDetailsOpen(open => !open)} className="min-h-9 rounded font-medium underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">{detailsOpen ? 'Hide' : 'View'} details for {selected.label}</button>
      <div id={`${id}-details`} hidden={!detailsOpen}>
        <p className="mb-2 text-muted-foreground">{selected.details.rows.length} provided {selected.details.rows.length === 1 ? 'row' : 'rows'}. Details supplied in this answer.</p>
        <div role="region" aria-label={`${selected.label} supplied details`} tabIndex={0} className="max-w-full overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-ring">
          <table aria-label={`${selected.label} supplied rows`} className="w-full text-left">
            <thead><tr>{selected.details.columns.map((column, index) => <th key={index} scope="col" className="whitespace-nowrap px-2 py-1 font-medium">{column}</th>)}</tr></thead>
            <tbody>{selected.details.rows.map((row, index) => <tr key={index} className="border-t">{row.map((cell, column) => <td key={column} className="break-words px-2 py-1">{cell}</td>)}</tr>)}</tbody>
          </table>
        </div>
      </div>
    </div> : <p className="border-t pt-2 text-xs text-muted-foreground">No underlying rows were supplied for {selected.label}. Only the plotted value is available.</p>)}
  </figure>
}
