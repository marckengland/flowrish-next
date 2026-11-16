import { z } from 'zod'

// A chart is data, never executable markup or model-generated rendering code.
export const aiChartSchema = z.object({
  type: z.enum(['bar', 'line']),
  title: z.string().trim().min(1).max(120),
  unit: z.string().trim().max(20).optional(),
  data: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    value: z.number().finite().min(-1e12).max(1e12),
  }).strict()).min(1).max(12),
}).strict()

export type AiChart = z.infer<typeof aiChartSchema>
