import { createTenantPrisma } from '@/server/db/middleware'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'

/**
 * AI Service for email generation, account research, and chatbot.
 * Uses OpenAI-compatible endpoint (Gemini API via AI_API_URL).
 *
 * Error handling: all failures return a generic message — never expose
 * API keys, URLs, model names, or internal error details.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GeneratedEmail {
  subject: string
  body: string
}

export interface AccountResearch {
  executiveSummary: string
  strategicGoals: string
  salesAngles: string[]
  challenges: string[]
}

export interface ChatResponse {
  message: string
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>
}

// ─── Generic error message ───────────────────────────────────────────────────

const AI_UNAVAILABLE_MESSAGE = 'AI service temporarily unavailable'

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Calls the AI API (OpenAI-compatible chat completions endpoint).
 * Throws AppError with generic message on any failure.
 */
async function callAI(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  temperature = 0.7,
  maxTokens = 2000,
): Promise<string> {
  const url = `${env.AI_API_URL}/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.AI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.AI_MODEL,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  })

  if (!response.ok) {
    // Log internally but never expose details
    console.error('[AI Service] API request failed with status:', response.status)
    throw new AppError('AI_UNAVAILABLE', AI_UNAVAILABLE_MESSAGE, 503)
  }

  const data = (await response.json()) as ChatCompletionResponse

  const content = data.choices?.[0]?.message?.content
  if (!content) {
    console.error('[AI Service] Empty response from AI API')
    throw new AppError('AI_UNAVAILABLE', AI_UNAVAILABLE_MESSAGE, 503)
  }

  return content
}

/**
 * Fetches the active system prompt for a given key within an organization.
 * Returns null if no active prompt config exists for the key.
 *
 * Validates: Requirement 8.4 — only include system prompts when active.
 */
async function getActiveSystemPrompt(
  key: string,
  orgId: string,
): Promise<string | null> {
  const db = createTenantPrisma(orgId)

  const config = await db.aiPromptConfig.findFirst({
    where: { key, isActive: true },
  })

  return config?.systemPrompt ?? null
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generates an AI-drafted email for a lead.
 *
 * Fetches lead context (name, title, company, last 5 interactions) and
 * the admin-configured system prompt, then calls the AI API to produce
 * a structured {subject, body} response.
 *
 * Validates: Requirements 8.1, 8.4, 8.5
 */
export async function generateEmail(
  leadId: string,
  userId: string,
  orgId: string,
): Promise<GeneratedEmail> {
  try {
    const db = createTenantPrisma(orgId)

    // Fetch lead with last 5 activities for context
    const lead = await db.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: {
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: { emailMessage: true },
        },
      },
    })

    if (!lead) {
      throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
    }

    // Build interaction history context
    let interactionHistory = ''
    if (lead.activities.length > 0) {
      interactionHistory =
        '\n\nRecent interactions:\n' +
        lead.activities
          .map((a) => {
            const date = a.createdAt.toISOString().split('T')[0]
            if (a.emailMessage) {
              return `- ${date}: Email "${a.emailMessage.subject}"`
            }
            return `- ${date}: ${a.type}${a.notes ? ` — ${a.notes}` : ''}`
          })
          .join('\n')
    }

    // Build the user prompt with lead context
    const userPrompt = [
      'Generate a personalized sales email for the following prospect:',
      '',
      `Name: ${lead.firstName} ${lead.lastName}`,
      lead.title ? `Title: ${lead.title}` : '',
      lead.companyName ? `Company: ${lead.companyName}` : '',
      lead.companyIndustry ? `Industry: ${lead.companyIndustry}` : '',
      interactionHistory,
      '',
      'Respond in JSON format: {"subject": "...", "body": "..."}',
      'The body should be HTML-formatted for rich text display.',
    ]
      .filter(Boolean)
      .join('\n')

    // Build messages array — include system prompt only if active
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

    const systemPrompt = await getActiveSystemPrompt('email_generation', orgId)
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: userPrompt })

    const raw = await callAI(messages)

    // Parse JSON response
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as GeneratedEmail
      return {
        subject: parsed.subject ?? '',
        body: parsed.body ?? '',
      }
    }

    // Fallback: use raw response as body
    return {
      subject: `Reaching out to ${lead.firstName}`,
      body: raw,
    }
  } catch (error) {
    // Re-throw AppError instances (LEAD_NOT_FOUND, AI_UNAVAILABLE)
    if (error instanceof AppError) {
      throw error
    }
    // All other errors: log internally, return generic message
    console.error('[AI Service] generateEmail failed:', error)
    throw new AppError('AI_UNAVAILABLE', AI_UNAVAILABLE_MESSAGE, 503)
  }
}

/**
 * Generates AI-powered account research for a company.
 *
 * Fetches company details and calls the AI API to produce structured
 * intelligence: executive summary, strategic goals, sales angles, challenges.
 *
 * Validates: Requirements 8.2, 8.4, 8.5
 */
export async function researchAccount(
  companyId: string,
  orgId: string,
): Promise<AccountResearch> {
  try {
    const db = createTenantPrisma(orgId)

    // Fetch company details
    const company = await db.company.findFirst({
      where: { id: companyId },
    })

    if (!company) {
      throw new AppError('COMPANY_NOT_FOUND', 'Company not found', 404)
    }

    // Build the user prompt with company context
    const userPrompt = [
      'Research the following company and provide sales intelligence:',
      '',
      `Company Name: ${company.name}`,
      company.website ? `Website: ${company.website}` : '',
      company.industry ? `Industry: ${company.industry}` : '',
      '',
      'Provide your analysis in JSON format:',
      '{',
      '  "executiveSummary": "High-level overview of the company...",',
      '  "strategicGoals": "Their likely strategic priorities...",',
      '  "salesAngles": ["Angle 1", "Angle 2", "Angle 3"],',
      '  "challenges": ["Challenge 1", "Challenge 2"]',
      '}',
    ]
      .filter(Boolean)
      .join('\n')

    // Build messages array — include system prompt only if active
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

    const systemPrompt = await getActiveSystemPrompt('account_research', orgId)
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: userPrompt })

    const raw = await callAI(messages)

    // Parse JSON response
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as AccountResearch
      return {
        executiveSummary: parsed.executiveSummary ?? '',
        strategicGoals: parsed.strategicGoals ?? '',
        salesAngles: Array.isArray(parsed.salesAngles) ? parsed.salesAngles : [],
        challenges: Array.isArray(parsed.challenges) ? parsed.challenges : [],
      }
    }

    // Fallback: use raw response as executive summary
    return {
      executiveSummary: raw,
      strategicGoals: '',
      salesAngles: [],
      challenges: [],
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    console.error('[AI Service] researchAccount failed:', error)
    throw new AppError('AI_UNAVAILABLE', AI_UNAVAILABLE_MESSAGE, 503)
  }
}

/**
 * Processes a chatbot message with context and returns a response.
 *
 * Validates: Requirements 8.3, 8.4, 8.5
 */
export async function chatMessage(
  message: string,
  userId: string,
  orgId: string,
): Promise<ChatResponse> {
  try {
    // Build messages array — include system prompt only if active
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

    const systemPrompt = await getActiveSystemPrompt('chatbot', orgId)
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: message })

    const responseText = await callAI(messages, 0.5, 1000)

    return { message: responseText }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    console.error('[AI Service] chatMessage failed:', error)
    throw new AppError('AI_UNAVAILABLE', AI_UNAVAILABLE_MESSAGE, 503)
  }
}
