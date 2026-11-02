import { z } from 'zod'

export const AI_PROVIDERS = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-flash' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-3.1-flash-lite' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: '' },
} as const
export type AiProvider = keyof typeof AI_PROVIDERS
export const DEFAULT_AI_LIMITS = { dailyRequestLimit: 20, dailyTokenLimit: 50000, maxOutputTokens: 2048, maxInputBytes: 16000 }
export const aiProviderSettingsSchema = z.object({
  provider: z.enum(['deepseek', 'gemini', 'openai']),
  model: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/, 'Enter a valid model identifier.'),
  apiKey: z.string().trim().max(500).regex(/^[\x21-\x7e]*$/, 'The API key cannot contain whitespace.').optional(),
  enabled: z.boolean(),
  dailyRequestLimit: z.number().int().min(1).max(1000),
  dailyTokenLimit: z.number().int().min(1000).max(10000000),
  maxOutputTokens: z.number().int().min(128).max(4096),
  maxInputBytes: z.number().int().min(1000).max(64000),
  expectedUpdatedAt: z.string().datetime().nullable(),
}).strict()
export interface AiProviderConfigView {
  provider: AiProvider
  model: string
  enabled: boolean
  hasKey: boolean
  dailyRequestLimit: number
  dailyTokenLimit: number
  maxOutputTokens: number
  maxInputBytes: number
  updatedAt: string
}
export interface AiUsageView {
  day: string
  requests: number
  reservedTokens: number
  reportedTokens: number
  completedRequests: number
  failedRequests: number
}
export interface AiProviderSettingsView {
  config: AiProviderConfigView | null
  usage: AiUsageView
  platformAvailable: boolean
}
