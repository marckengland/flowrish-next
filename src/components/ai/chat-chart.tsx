'use client'

import { useId } from 'react'
import type { AiChart } from '@/lib/ai-chart'

export function ChatChart({ chart }: { chart: AiChart }) {
  const id = useId()
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
    <svg viewBox="0 0 320 180" role="img" aria-label={chart.title} className="h-auto w-full text-primary">
      <desc>Chart of the supplied values. Exact labels and values are in the table below.</desc>
      <line x1="20" x2="300" y1={baseline} y2={baseline} stroke="currentColor" strokeOpacity="0.35" />
      {chart.type === 'line' && <polyline points={chart.data.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" />}
      {chart.data.map((point, index) => <g key={index}>
        <title>{point.label}: {point.value}{chart.unit ? ` ${chart.unit}` : ''}</title>
        {chart.type === 'bar'
          ? (point.value === 0 ? <circle cx={x(index)} cy={baseline} r="2" fill="currentColor" /> : <rect x={x(index) - width / 2} y={Math.min(baseline, y(point.value))} width={width} height={Math.abs(baseline - y(point.value))} rx="2" fill="currentColor" />)
          : <circle cx={x(index)} cy={y(point.value)} r="3" fill="currentColor" />}
        {chart.data.length <= 6 && <text x={x(index)} y={point.value >= 0 ? Math.max(12, y(point.value) - 5) : Math.min(158, y(point.value) + 12)} textAnchor="middle" fill="currentColor" fontSize="10">{shortValue.format(point.value)}</text>}
        <text x={x(index)} y="175" textAnchor="middle" fill="currentColor" fontSize="10">{index + 1}</text>
      </g>)}
    </svg>
    <div role="region" aria-label={`${chart.title} data`} tabIndex={0} className="max-w-full overflow-x-auto rounded focus-visible:outline-2 focus-visible:outline-ring">
      <table aria-label={`${chart.title} data`} className="w-full text-left text-xs">
        <thead><tr><th scope="col" className="py-1 pr-2 font-medium">#</th><th scope="col" className="py-1 pr-3 font-medium">Category</th><th scope="col" className="py-1 text-right font-medium">Value{chart.unit ? ` (${chart.unit})` : ''}</th></tr></thead>
        <tbody>{chart.data.map((point, index) => <tr key={index} className="border-t"><td className="py-1 pr-2 text-muted-foreground">{index + 1}</td><td className="break-words py-1 pr-3">{point.label}</td><td className="py-1 text-right tabular-nums">{point.value}</td></tr>)}</tbody>
      </table>
    </div>
  </figure>
}
