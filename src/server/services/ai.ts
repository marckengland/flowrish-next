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
  /**
   * Short note about the company's AI / tech readiness — useful for
   * gauging openness to modernization conversations.
   */
  aiReadiness: string
  /**
   * Sources the model cites for the research. Each entry is either a
   * URL (rendered as a link) or a free-form descriptor.
   */
  sources: string[]
}

export interface ChatNavigateAction {
  type: 'navigate'
  description: string
  params: { path: string }
}

export interface ChatResponse {
  message: string
  /**
   * Optional follow-up action proposed by the assistant. Today only
   * `navigate` is supported — see `extractNavigateAction` below for the
   * marker format and `ChatbotSidebar` for the client confirm/reject
   * UX.
   */
  action?: ChatNavigateAction
}

export interface TrackerMatch {
  keyword: string
  context: string
}

export interface MeetingSummary {
  id: string
  leadId: string
  leadName: string
  meetingDate: string
  attendees: string[]
  rawNotes: string
  aiSummary: string | null
  keyTopics: string[]
  actionItems: string[]
  sentiment: 'positive' | 'neutral' | 'negative' | null
  trackers: TrackerMatch[]
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

export interface GenerateEmailOptions {
  /** Free-form description of what the email should accomplish. */
  instructions?: string
  /** Tone preset or custom string (e.g. "Helpful and friendly"). */
  tone?: string
  /** Goal / CTA (e.g. "Book a meeting"). */
  goal?: string
  /**
   * Whether to include the lead's last 5 interactions in the prompt.
   * Defaults to `true` to preserve the prior behaviour of the
   * parameter-less `generateEmail(leadId, userId, orgId)` call.
   */
  includeContext?: boolean
}

/**
 * Generates an AI-drafted email for a lead.
 *
 * Fetches lead context (name, title, company, last 5 interactions when
 * `options.includeContext !== false`) and the admin-configured system
 * prompt, then calls the AI API to produce a structured {subject, body}
 * response. Optional `instructions`, `tone`, and `goal` from the caller
 * are folded into the user prompt so the rep can steer the draft.
 *
 * Validates: Requirements 8.1, 8.4, 8.5
 */
export async function generateEmail(
  leadId: string,
  userId: string,
  orgId: string,
  options: GenerateEmailOptions = {},
): Promise<GeneratedEmail> {
  try {
    const includeContext = options.includeContext !== false
    const db = createTenantPrisma(orgId)

    // Fetch lead with last 5 activities for context (when enabled)
    const lead = await db.lead.findFirst({
      where: { id: leadId, deletedAt: null },
      include: includeContext
        ? {
            activities: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              include: { emailMessage: true },
            },
          }
        : undefined,
    })

    if (!lead) {
      throw new AppError('LEAD_NOT_FOUND', 'Lead not found', 404)
    }

    // Build interaction history context only when requested.
    let interactionHistory = ''
    if (
      includeContext
      && 'activities' in lead
      && Array.isArray((lead as unknown as { activities?: unknown[] }).activities)
    ) {
      const activities = (lead as unknown as {
        activities: Array<{
          createdAt: Date
          type: string
          notes: string | null
          emailMessage: { subject: string } | null
        }>
      }).activities
      if (activities.length > 0) {
        interactionHistory =
          '\n\nRecent interactions:\n'
          + activities
            .map((a) => {
              const date = a.createdAt.toISOString().split('T')[0]
              if (a.emailMessage) {
                return `- ${date}: Email "${a.emailMessage.subject}"`
              }
              return `- ${date}: ${a.type}${a.notes ? ` — ${a.notes}` : ''}`
            })
            .join('\n')
      }
    }

    // Build the user prompt with lead context and rep-supplied steering.
    const userPrompt = [
      'Generate a personalized sales email for the following prospect:',
      '',
      `Name: ${lead.firstName} ${lead.lastName}`,
      lead.title ? `Title: ${lead.title}` : '',
      lead.companyName ? `Company: ${lead.companyName}` : '',
      lead.companyIndustry ? `Industry: ${lead.companyIndustry}` : '',
      interactionHistory,
      '',
      options.tone ? `Tone: ${options.tone}` : '',
      options.goal ? `Primary goal / CTA: ${options.goal}` : '',
      options.instructions
        ? `Additional instructions: ${options.instructions}`
        : '',
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
      '  "challenges": ["Challenge 1", "Challenge 2"],',
      '  "aiReadiness": "Short note on AI / tech adoption posture",',
      '  "sources": ["https://example.com", "Industry report 2024"]',
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
        aiReadiness: parsed.aiReadiness ?? '',
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      }
    }

    // Fallback: use raw response as executive summary
    return {
      executiveSummary: raw,
      strategicGoals: '',
      salesAngles: [],
      challenges: [],
      aiReadiness: '',
      sources: [],
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
 * The assistant can optionally include a navigation hint in its reply
 * by appending a final-line marker `[NAVIGATE: /path]`. When present we
 * strip it from the user-facing `message` and surface it as a
 * structured `action` payload so the chat client can offer a confirm /
 * reject card. We deliberately keep the action surface narrow — only
 * routes within the app are accepted — so a misbehaving model can't
 * push destructive actions onto the user.
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
    // (Requirement 8.4: never inject defaults that the admin didn't opt in to).
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

    const systemPrompt = await getActiveSystemPrompt('chatbot', orgId)
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }

    // Inline the navigation-marker hint with the user's message rather
    // than fabricate a system prompt. The hint is short, ignored by
    // models that can't act on it, and keeps the
    // "no system prompt unless admin-configured" invariant intact.
    const NAVIGATE_HINT =
      ' \n\n(If the user clearly asks to navigate to a page in the app, '
      + 'append a final line in the exact form `[NAVIGATE: /path]` with '
      + 'an in-app route. Otherwise omit it.)'

    messages.push({ role: 'user', content: message + NAVIGATE_HINT })

    const responseText = await callAI(messages, 0.5, 1000)

    // Detect the navigation marker on the final non-empty line.
    const { message: cleaned, action } = extractNavigateAction(responseText)
    return { message: cleaned, action }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    console.error('[AI Service] chatMessage failed:', error)
    throw new AppError('AI_UNAVAILABLE', AI_UNAVAILABLE_MESSAGE, 503)
  }
}

/**
 * Pulls a `[NAVIGATE: /path]` marker out of an assistant message and
 * converts it to a structured action. Returns the cleaned message plus
 * the action (or undefined). Only same-origin paths are accepted.
 */
function extractNavigateAction(text: string): {
  message: string
  action?: ChatNavigateAction
} {
  const match = text.match(/\[NAVIGATE:\s*(\/[^\]\s]*)\s*\]\s*$/)
  if (!match) return { message: text.trim() }
  const path = match[1]
  if (!path.startsWith('/')) return { message: text.trim() }
  const cleaned = text.slice(0, match.index).trim()
  return {
    message: cleaned,
    action: {
      type: 'navigate',
      description: `Open ${path}`,
      params: { path },
    },
  }
}

// ─── Conversation Intelligence ───────────────────────────────────────────────

/** Default tracker keywords for sales conversations */
const DEFAULT_TRACKERS = [
  'pricing', 'budget', 'competitor', 'timeline', 'decision maker',
  'next steps', 'objection', 'contract', 'demo', 'trial',
  'pain point', 'roi', 'implementation', 'integration', 'security',
]

/**
 * Detects tracker keyword matches in meeting notes and returns matched contexts.
 */
function detectTrackers(notes: string): TrackerMatch[] {
  const trackers: TrackerMatch[] = []
  const notesLower = notes.toLowerCase()

  for (const keyword of DEFAULT_TRACKERS) {
    if (notesLower.includes(keyword)) {
      const idx = notesLower.indexOf(keyword)
      const start = Math.max(0, idx - 50)
      const end = Math.min(notes.length, idx + keyword.length + 50)
      trackers.push({
        keyword,
        context: notes.slice(start, end).trim(),
      })
    }
  }

  return trackers
}

/**
 * Summarizes a meeting activity using AI.
 *
 * Sends meeting data (notes, attendees, date) to the AI provider and returns
 * a structured summary with aiSummary, keyTopics, actionItems, sentiment, and trackers.
 * Stores the generated summary on the activity for future retrieval.
 *
 * Idempotent: if the activity already has an aiSummary, returns the stored data
 * without calling the AI again.
 *
 * Validates: Requirements 31.1, 31.2, 31.4
 */
export async function summarizeMeeting(
  activityId: string,
  orgId: string,
): Promise<MeetingSummary> {
  try {
    const db = createTenantPrisma(orgId)

    const activity = await db.activity.findFirst({
      where: { id: activityId },
      include: {
        lead: { select: { id: true, firstName: true, lastName: true, companyName: true } },
      },
    })

    if (!activity) {
      throw new AppError('ACTIVITY_NOT_FOUND', 'Activity not found', 404)
    }

    if (activity.type !== 'MEETING' && activity.type !== 'CALL') {
      throw new AppError('INVALID_ACTIVITY_TYPE', 'Activity must be a meeting or call', 400)
    }

    const notes = activity.notes ?? ''
    if (!notes.trim()) {
      throw new AppError('NO_NOTES', 'No notes to summarize', 400)
    }

    const leadName = `${activity.lead.firstName} ${activity.lead.lastName}`.trim()
    const attendees: string[] = activity.attendees
      ? (JSON.parse(activity.attendees) as string[])
      : []
    const meetingDate = (
      activity.meetingDate ?? activity.callDate ?? activity.createdAt
    ).toISOString()

    // Detect tracker keyword matches
    const trackers = detectTrackers(notes)

    // Idempotent: return stored summary if already generated
    if (activity.aiSummary) {
      return {
        id: activity.id,
        leadId: activity.lead.id,
        leadName,
        meetingDate,
        attendees,
        rawNotes: notes,
        aiSummary: activity.aiSummary,
        keyTopics: activity.keyTopics ?? [],
        actionItems: activity.actionItems ?? [],
        sentiment: (['positive', 'neutral', 'negative'].includes(activity.sentiment ?? '')
          ? (activity.sentiment as MeetingSummary['sentiment'])
          : null),
        trackers,
      }
    }

    // AI summarization
    const systemPrompt = 'You are a sales meeting analyst. Summarize meeting notes into actionable insights. Be concise and specific. Output JSON format.'
    const userPrompt = [
      'Summarize the following meeting/call notes:',
      '',
      `Lead: ${leadName}`,
      activity.lead.companyName ? `Company: ${activity.lead.companyName}` : '',
      attendees.length > 0 ? `Attendees: ${attendees.join(', ')}` : '',
      `Date: ${meetingDate.split('T')[0]}`,
      '',
      'Notes:',
      notes,
      '',
      'Respond in JSON:',
      '{',
      '  "summary": "2-3 sentence summary of the meeting",',
      '  "keyTopics": ["topic1", "topic2", "topic3"],',
      '  "actionItems": ["action1", "action2"],',
      '  "sentiment": "positive" | "neutral" | "negative"',
      '}',
    ]
      .filter(Boolean)
      .join('\n')

    // Include active system prompt if configured
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []

    const activePrompt = await getActiveSystemPrompt('meeting_summary', orgId)
    if (activePrompt) {
      messages.push({ role: 'system', content: activePrompt })
    } else {
      messages.push({ role: 'system', content: systemPrompt })
    }

    messages.push({ role: 'user', content: userPrompt })

    let aiSummary: string | null = null
    let keyTopics: string[] = []
    let actionItems: string[] = []
    let sentiment: MeetingSummary['sentiment'] = null

    const raw = await callAI(messages, 0.3, 1500)
    const jsonMatch = raw.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        summary?: string
        keyTopics?: string[]
        actionItems?: string[]
        sentiment?: string
      }
      aiSummary = parsed.summary ?? null
      keyTopics = Array.isArray(parsed.keyTopics) ? parsed.keyTopics : []
      actionItems = Array.isArray(parsed.actionItems) ? parsed.actionItems : []
      sentiment = ['positive', 'neutral', 'negative'].includes(parsed.sentiment ?? '')
        ? (parsed.sentiment as MeetingSummary['sentiment'])
        : null
    }

    // Store the summary on the activity for future retrieval (Requirement 31.2)
    await db.activity.update({
      where: { id: activityId },
      data: {
        aiSummary,
        keyTopics,
        actionItems,
        sentiment,
      },
    })

    return {
      id: activity.id,
      leadId: activity.lead.id,
      leadName,
      meetingDate,
      attendees,
      rawNotes: notes,
      aiSummary,
      keyTopics,
      actionItems,
      sentiment,
      trackers,
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }
    console.error('[AI Service] summarizeMeeting failed:', error)
    throw new AppError('AI_UNAVAILABLE', AI_UNAVAILABLE_MESSAGE, 503)
  }
}

/**
 * Lists all meeting/call summaries for a lead (conversation history).
 *
 * Returns activities of type MEETING or CALL with their stored summaries
 * and detected tracker keywords. Summaries are only populated for activities
 * that have been previously summarized via summarizeMeeting.
 *
 * Validates: Requirement 31.3
 */
export async function getLeadConversations(
  leadId: string,
  orgId: string,
): Promise<MeetingSummary[]> {
  const db = createTenantPrisma(orgId)

  const activities = await db.activity.findMany({
    where: {
      leadId,
      type: { in: ['MEETING', 'CALL'] },
    },
    include: {
      lead: { select: { id: true, firstName: true, lastName: true, companyName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return activities.map((activity) => {
    const notes = activity.notes ?? ''
    const trackers = detectTrackers(notes)

    return {
      id: activity.id,
      leadId: activity.lead.id,
      leadName: `${activity.lead.firstName} ${activity.lead.lastName}`.trim(),
      meetingDate: (
        activity.meetingDate ?? activity.callDate ?? activity.createdAt
      ).toISOString(),
      attendees: activity.attendees
        ? (JSON.parse(activity.attendees) as string[])
        : [],
      rawNotes: notes,
      aiSummary: activity.aiSummary ?? null,
      keyTopics: activity.keyTopics ?? [],
      actionItems: activity.actionItems ?? [],
      sentiment: (['positive', 'neutral', 'negative'].includes(activity.sentiment ?? '')
        ? (activity.sentiment as MeetingSummary['sentiment'])
        : null),
      trackers,
    }
  })
}
