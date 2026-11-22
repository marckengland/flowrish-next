import { z } from 'zod'

const value = z.number().finite().min(-1e12).max(1e12)
const details = z.object({
  columns: z.array(z.string().trim().min(1).max(40)).min(1).max(6)
    .refine(columns => new Set(columns.map(column => column.toLowerCase())).size === columns.length, 'Column names must be distinct'),
  rows: z.array(z.array(z.union([z.string().max(160), value])).min(1).max(6)).min(1).max(20),
}).strict().refine(table => table.rows.every(row => row.length === table.columns.length), 'Rows must match the supplied columns')

// A chart is data, never executable markup or model-generated rendering code.
export const aiChartSchema = z.object({
  type: z.enum(['bar', 'line']),
  title: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(20).optional(),
  data: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    value,
    details: details.optional(),
  }).strict()).min(1).max(12),
}).strict()

export type AiChart = z.infer<typeof aiChartSchema>
