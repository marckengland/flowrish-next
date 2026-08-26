import { createTenantPrisma } from '@/server/db/middleware'
import { env } from '@/lib/env'
import { AppError } from '@/lib/errors'
import { fetchSiteText } from '@/lib/web/fetch-site'

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
   * Summary of what the company does, grounded in their actual website
   * content when it could be fetched (empty otherwise).
   */
  websiteSummary: string
  /**
   * Background-check / business evaluation: whether and how this company
   * would benefit from tech/software solutions, with the specific
   * problem → solution reasoning.
   */
  solutionFit: string
  /**
   * A concrete opening outreach angle — a problem-probing question to
   * ask them plus the solution to offer in reply.
   */
  outreachAngle: string
  /**
   * Sources the model cites for the research. Each entry is either a
   * URL (rendered as a link) or a free-form descriptor.
   */
  sources: string[]
}

/**
 * Action types the AI assistant can propose. The chatbot client
 * surfaces these as confirm/reject cards (or auto-runs them when the
 * user has flipped on auto-confirm). Each variant carries its own
 * `params` shape so the executor can validate without runtime
 * inspection.
 */
export type ChatAction =
  | {
      type: 'navigate'
      description: string
      params: { path: string }
    }
  | {
      type: 'create_lead'
      description: string
      params: {
        firstName: string
        lastName: string
        email?: string
        phone?: string
        title?: string
        companyName?: string
        leadStatus?: string
        tier?: string
        dealValue?: number
      }
    }
  | {
      type: 'create_task'
      description: string
      params: {
        title: string
        description?: string
        priority?: 'LOW' | 'MEDIUM' | 'HIGH'
        dueDate?: string
        leadId?: string
        assigneeId?: string
      }
    }
  | {
      type: 'update_lead_status'
      description: string
      params: { leadId: string; leadStatus: string }
    }
  | {
      type: 'update_lead_tier'
      description: string
      params: { leadId: string; tier: string }
    }
  | {
      type: 'enroll_in_cadence'
      description: string
      params: { cadenceId: string; leadId: string }
    }
  | {
      type: 'create_cadence'
      description: string
      params: {
        name: string
        steps: Array<{
          actionType: 'EMAIL' | 'CALL' | 'LINKEDIN' | 'MANUAL_TASK'
          /** Wait before this step, in hours (0 = immediately). */
          delayHours?: number
          /** EMAIL steps: subject + body. */
          subject?: string
          body?: string
          /** CALL / LINKEDIN / MANUAL_TASK steps: task title + description. */
          taskTitle?: string
          taskDescription?: string
        }>
      }
    }

/**
 * Backward-compatible alias for the navigate variant. Older callers
 * import this name; new code should reference the `ChatAction` union.
 */
export type ChatNavigateAction = Extract<ChatAction, { type: 'navigate' }>

export interface ChatResponse {
  message: string
  /**
   * Optional follow-up action proposed by the assistant. The shape
   * is union-typed so the client can route by `action.type` rather
   * than runtime detection.
   */
  action?: ChatAction
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
    // Log the provider's actual error internally (server-side only) so
    // misconfigurations — missing/placeholder API key, deprecated model
    // name, quota — are diagnosable from the logs. The client still only
    // ever sees the generic AI_UNAVAILABLE_MESSAGE.
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 500)
    } catch {
      // ignore — body already consumed or unavailable
    }
    console.error(
      `[AI Service] API request failed (status ${response.status}, model "${env.AI_MODEL}"):`,
      detail,
    )
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

    // Ground the research in the company's ACTUAL website content when we
    // can fetch it safely (SSRF-guarded). Best-effort: if the site is
    // unreachable/blocked, research still runs on name + industry alone.
    let siteExcerpt: string | null = null
    if (company.website) {
      const text = await fetchSiteText(company.website)
      if (text) siteExcerpt = text.slice(0, 4000)
    }

    // Build the user prompt with company context. The format lock + grounding
    // + citation guard are tuned for the Gemini backend, which otherwise
    // drifts from strict JSON and fabricates source URLs.
    const userPrompt = [
      'You are a B2B sales-intelligence analyst evaluating whether a company is a',
      'good fit for a tech/software solutions vendor. Be specific and concrete.',
      '',
      'Company:',
      `- Name: ${company.name}`,
      company.website ? `- Website: ${company.website}` : '',
      company.industry ? `- Industry: ${company.industry}` : '',
      siteExcerpt
        ? `\nWebsite content (excerpt). Ground "websiteSummary" and "solutionFit" in THIS text; do not assert facts it does not support:\n"""\n${siteExcerpt}\n"""`
        : '\nNo website content was available. Reason only from well-known public knowledge; if unsure, keep fields brief and do not invent specifics.',
      '',
      'Return ONLY a single valid JSON object — no markdown code fences, no text',
      'before or after — with exactly these keys:',
      '{',
      '  "executiveSummary": "2-3 sentence overview",',
      '  "websiteSummary": "What the company does, grounded in the website text above; empty string if none was provided",',
      '  "strategicGoals": "Their likely strategic priorities",',
      '  "salesAngles": ["angle", "..."],',
      '  "challenges": ["challenge", "..."],',
      '  "aiReadiness": "Short note on their AI / tech adoption posture",',
      '  "solutionFit": "Whether and HOW they would benefit from tech/software solutions — name the specific business problem and the solution that addresses it",',
      '  "outreachAngle": "One problem-probing question to ask them, plus the solution to offer once they respond",',
      '  "sources": ["only URLs or sources you are confident actually exist — never fabricate citations; use [] if none"]',
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
        websiteSummary: parsed.websiteSummary ?? '',
        strategicGoals: parsed.strategicGoals ?? '',
        salesAngles: Array.isArray(parsed.salesAngles) ? parsed.salesAngles : [],
        challenges: Array.isArray(parsed.challenges) ? parsed.challenges : [],
        aiReadiness: parsed.aiReadiness ?? '',
        solutionFit: parsed.solutionFit ?? '',
        outreachAngle: parsed.outreachAngle ?? '',
        sources: Array.isArray(parsed.sources) ? parsed.sources : [],
      }
    }

    // Fallback: use raw response as executive summary
    return {
      executiveSummary: raw,
      websiteSummary: '',
      strategicGoals: '',
      salesAngles: [],
      challenges: [],
      aiReadiness: '',
      solutionFit: '',
      outreachAngle: '',
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
 * Inline hint appended to the user's chat message so the assistant
 * knows the supported action format without us injecting a system
 * prompt (which would violate Requirement 8.4: "no system prompt
 * unless an admin-active config exists").
 *
 * Models that can't act on the format simply ignore it, so the chat
 * still works as a Q&A surface.
 */
const CHAT_ACTION_HINT = [
  '',
  '',
  '(Optional: if the user wants you to perform an action in the app,',
  'append a final block in the exact form `[ACTION]{...JSON...}[/ACTION]`.',
  'Available action types: navigate, create_lead, create_task,',
  'update_lead_status, update_lead_tier, enroll_in_cadence, create_cadence.',
  'Examples of params:',
  '  - navigate: { "path": "/leads" }',
  '  - create_lead: { "firstName": "Ada", "lastName": "Lovelace", "companyName": "Acme" }',
  '  - create_task: { "title": "Follow up", "leadId": "<uuid>", "priority": "HIGH" }',
  '  - update_lead_status: { "leadId": "<uuid>", "leadStatus": "Active" }',
  '  - update_lead_tier: { "leadId": "<uuid>", "tier": "Tier 1" }',
  '  - enroll_in_cadence: { "cadenceId": "<uuid>", "leadId": "<uuid>" }',
  '  - create_cadence: build a multi-step outreach sequence. Propose this ONLY when the user asks to create, build, or design a cadence / sequence / flow — otherwise omit it. Params:',
  '      { "name": "<cadence name>", "steps": [ { "actionType": "EMAIL"|"CALL"|"LINKEDIN"|"MANUAL_TASK", "delayHours": <integer wait BEFORE this step, 0 = immediately>, "subject": "<EMAIL only>", "body": "<EMAIL only, HTML allowed>", "taskTitle": "<CALL/LINKEDIN/MANUAL_TASK>", "taskDescription": "<optional>" } ] }',
  '      Rules: include at least one step, in execution order; EMAIL steps use subject+body, all other types use taskTitle (+ optional taskDescription); the cadence is created as a DRAFT for the user to review and activate. Example:',
  '      { "name": "SMB Outbound", "steps": [ {"actionType":"EMAIL","delayHours":0,"subject":"Quick question about {Company}","body":"Hi {FirstName}, …"}, {"actionType":"CALL","delayHours":48,"taskTitle":"Call the prospect"} ] }',
  'Never propose destructive actions. Always explain in plain text BEFORE the action block.',
  'Omit the block entirely when the user is just asking a question.)',
].join('\n')

/**
 * Processes a chatbot message and returns the assistant's reply
 * along with any action it has proposed.
 *
 * The assistant can append a single `[ACTION]…[/ACTION]` block at
 * the end of its message. The parser strips the block from the
 * user-facing text and returns it as a structured payload so the
 * client can show a confirm / reject card. Allowed action types are
 * declared in {@link ChatAction}; unknown types are ignored.
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

    messages.push({ role: 'user', content: message + CHAT_ACTION_HINT })

    const responseText = await callAI(messages, 0.5, 1000)

    const { message: cleaned, action } = extractActionBlock(responseText)
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
 * Pulls a `[ACTION]{json}[/ACTION]` block out of the assistant's
 * message and converts it to a structured action. Returns the
 * cleaned message plus the action (or undefined when no valid block
 * was found). Unknown action types or malformed JSON are silently
 * dropped — better to lose a single proposed action than to crash
 * the whole chat round-trip.
 *
 * Exported so the chat tests can drive the parser without touching
 * the AI provider.
 */
export function extractActionBlock(text: string): {
  message: string
  action?: ChatAction
} {
  const match = text.match(/\[ACTION\]([\s\S]*?)\[\/ACTION\]/)
  if (!match) {
    // Fall back to the legacy single-line `[NAVIGATE: /path]` marker
    // we shipped in the previous iteration so older deployments still
    // benefit from navigate actions during the transition.
    const legacy = text.match(/\[NAVIGATE:\s*(\/[^\]\s]*)\s*\]\s*$/)
    if (legacy) {
      const path = legacy[1]
      const cleaned = text.slice(0, legacy.index).trim()
      return {
        message: cleaned,
        action: {
          type: 'navigate',
          description: `Open ${path}`,
          params: { path },
        },
      }
    }
    return { message: text.trim() }
  }

  const cleaned = text.replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(match[1].trim())
  } catch {
    return { message: cleaned }
  }

  const action = sanitizeChatAction(parsed)
  if (!action) {
    return { message: cleaned }
  }

  return { message: cleaned, action }
}

/**
 * Validates a parsed action payload against the {@link ChatAction}
 * union and normalizes its shape. Anything that doesn't match a
 * known action type — or is missing the required params — is
 * rejected.
 *
 * Defensive: a misbehaving model could emit a `delete_*` action
 * and the executor would refuse, but the front-end shouldn't even
 * see it. Better to drop the block here.
 */
function sanitizeChatAction(input: unknown): ChatAction | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const type = obj.type
  const description =
    typeof obj.description === 'string' ? obj.description : 'Run action'
  const params =
    obj.params && typeof obj.params === 'object'
      ? (obj.params as Record<string, unknown>)
      : null
  if (!params) return null

  switch (type) {
    case 'navigate': {
      const path = params.path
      if (typeof path !== 'string' || !path.startsWith('/')) return null
      return { type: 'navigate', description, params: { path } }
    }
    case 'create_lead': {
      const firstName = stringOrNull(params.firstName)
      const lastName = stringOrNull(params.lastName)
      if (!firstName || !lastName) return null
      return {
        type: 'create_lead',
        description,
        params: {
          firstName,
          lastName,
          email: stringOrUndef(params.email),
          phone: stringOrUndef(params.phone),
          title: stringOrUndef(params.title),
          companyName: stringOrUndef(params.companyName),
          leadStatus: stringOrUndef(params.leadStatus),
          tier: stringOrUndef(params.tier),
          dealValue:
            typeof params.dealValue === 'number'
              ? params.dealValue
              : typeof params.dealValue === 'string'
                ? Number(params.dealValue) || undefined
                : undefined,
        },
      }
    }
    case 'create_task': {
      const title = stringOrNull(params.title)
      if (!title) return null
      const priority =
        params.priority === 'LOW'
          || params.priority === 'MEDIUM'
          || params.priority === 'HIGH'
          ? params.priority
          : undefined
      return {
        type: 'create_task',
        description,
        params: {
          title,
          description: stringOrUndef(params.description),
          priority,
          dueDate: stringOrUndef(params.dueDate),
          leadId: stringOrUndef(params.leadId),
          assigneeId: stringOrUndef(params.assigneeId),
        },
      }
    }
    case 'update_lead_status': {
      const leadId = stringOrNull(params.leadId)
      const leadStatus = stringOrNull(params.leadStatus)
      if (!leadId || !leadStatus) return null
      return {
        type: 'update_lead_status',
        description,
        params: { leadId, leadStatus },
      }
    }
    case 'update_lead_tier': {
      const leadId = stringOrNull(params.leadId)
      const tier = stringOrNull(params.tier)
      if (!leadId || !tier) return null
      return {
        type: 'update_lead_tier',
        description,
        params: { leadId, tier },
      }
    }
    case 'enroll_in_cadence': {
      const cadenceId = stringOrNull(params.cadenceId)
      const leadId = stringOrNull(params.leadId)
      if (!cadenceId || !leadId) return null
      return {
        type: 'enroll_in_cadence',
        description,
        params: { cadenceId, leadId },
      }
    }
    case 'create_cadence': {
      const name = stringOrNull(params.name)
      if (!name) return null
      if (!Array.isArray(params.steps) || params.steps.length === 0) return null

      const validActionTypes = ['EMAIL', 'CALL', 'LINKEDIN', 'MANUAL_TASK']
      const steps: Extract<
        ChatAction,
        { type: 'create_cadence' }
      >['params']['steps'] = []

      for (const raw of params.steps) {
        if (!raw || typeof raw !== 'object') return null
        const s = raw as Record<string, unknown>
        const actionType = s.actionType
        if (
          typeof actionType !== 'string'
          || !validActionTypes.includes(actionType)
        ) {
          return null
        }
        const delayHours =
          typeof s.delayHours === 'number'
            ? Math.max(0, Math.trunc(s.delayHours))
            : typeof s.delayHours === 'string'
              ? Math.max(0, Math.trunc(Number(s.delayHours) || 0))
              : undefined
        steps.push({
          actionType: actionType as
            | 'EMAIL'
            | 'CALL'
            | 'LINKEDIN'
            | 'MANUAL_TASK',
          delayHours,
          subject: stringOrUndef(s.subject),
          body: stringOrUndef(s.body),
          taskTitle: stringOrUndef(s.taskTitle),
          taskDescription: stringOrUndef(s.taskDescription),
        })
      }

      return { type: 'create_cadence', description, params: { name, steps } }
    }
    default:
      return null
  }
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null
}

function stringOrUndef(value: unknown): string | undefined {
  const result = stringOrNull(value)
  return result ?? undefined
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


// ─── Chat Action Executor ────────────────────────────────────────────────────

import { tenantData } from '@/server/db/types'

export interface ChatActionResult {
  success: boolean
  message: string
  data?: Record<string, unknown>
}

/**
 * Performs a chat action server-side after the user has confirmed it
 * (or implicitly approved it via auto-confirm). Each branch reuses
 * the existing service / repository so audit, RBAC, and validation
 * stay consistent with the manual UI paths.
 *
 * Navigate actions are handled client-side — we only return a
 * success result for completeness so the client can show a "done"
 * status badge.
 *
 * Failures bubble up as `{ success: false, message }` — the client
 * never crashes the chat surface on a bad action proposal.
 *
 * Service imports are dynamic inside this function rather than at
 * the top of the file so the test harness for the AI service can
 * mock environment variables without the leads/tasks modules eagerly
 * initializing dependent clients (Redis, Prisma) at import time.
 *
 * Validates: Requirements 8.3
 */
export async function executeChatAction(
  action: ChatAction,
  userId: string,
  orgId: string,
): Promise<ChatActionResult> {
  try {
    switch (action.type) {
      case 'navigate': {
        // Navigation runs in the browser. Returning success here lets
        // the client mark the action card as "executed" without an
        // additional round-trip.
        return {
          success: true,
          message: `Navigating to ${action.params.path}.`,
          data: { path: action.params.path },
        }
      }

      case 'create_lead': {
        // Pick the first available pipeline stage so the new lead has
        // somewhere to live without forcing the user to pick one in
        // chat. Mirrors the original Flowrish behaviour.
        const db = createTenantPrisma(orgId)
        let stage = await db.stage.findFirst({
          orderBy: { order: 'asc' },
          select: { id: true },
        })
        if (!stage) {
          // No pipeline yet — auto-create the default one through the
          // pipeline service and pick the first stage from that.
          const { getOrCreateDefaultPipeline } = await import(
            '@/server/services/pipeline'
          )
          const pipeline = await getOrCreateDefaultPipeline(orgId)
          stage = pipeline.stages[0]
            ? { id: pipeline.stages[0].id }
            : null
        }
        if (!stage) {
          return {
            success: false,
            message: 'Could not resolve a pipeline stage for the new lead.',
          }
        }

        const { createLead } = await import('@/server/services/leads')
        const lead = await createLead(
          {
            firstName: action.params.firstName,
            lastName: action.params.lastName,
            stageId: stage.id,
            email: action.params.email ?? null,
            phone: action.params.phone ?? null,
            title: action.params.title ?? null,
            companyName: action.params.companyName ?? null,
            leadStatus: action.params.leadStatus ?? 'Open',
            tier: action.params.tier ?? null,
            dealValue:
              action.params.dealValue !== undefined
                ? String(action.params.dealValue)
                : null,
          },
          userId,
          orgId,
        )

        return {
          success: true,
          message: `Lead "${action.params.firstName} ${action.params.lastName}" created.`,
          data: {
            leadId: lead.id,
            path: `/leads/${lead.id}`,
          },
        }
      }

      case 'create_task': {
        const db = createTenantPrisma(orgId)
        // Tasks must be attached to a lead. If the model didn't supply
        // one, attach to the most recently updated lead the user can
        // see — useful for "remind me to follow up tomorrow" style
        // requests where the lead context is implicit.
        let leadId = action.params.leadId
        if (!leadId) {
          const recent = await db.lead.findFirst({
            where: { deletedAt: null },
            orderBy: { updatedAt: 'desc' },
            select: { id: true },
          })
          if (!recent) {
            return {
              success: false,
              message: 'No leads exist to attach the task to. Create a lead first.',
            }
          }
          leadId = recent.id
        }

        const dueDate = action.params.dueDate
          ? new Date(action.params.dueDate)
          : new Date(Date.now() + 24 * 60 * 60 * 1000)

        const { createTask } = await import('@/server/services/tasks')
        const task = await createTask(
          {
            title: action.params.title,
            description: action.params.description ?? null,
            priority: action.params.priority ?? 'MEDIUM',
            dueDate,
            leadId,
            assigneeId: action.params.assigneeId ?? userId,
          },
          userId,
          orgId,
        )

        return {
          success: true,
          message: `Task "${action.params.title}" created.`,
          data: { taskId: task.id, leadId },
        }
      }

      case 'update_lead_status': {
        const db = createTenantPrisma(orgId)
        const lead = await db.lead.findFirst({
          where: { id: action.params.leadId, deletedAt: null },
        })
        if (!lead) {
          return { success: false, message: 'Lead not found.' }
        }
        await db.lead.update({
          where: { id: action.params.leadId },
          data: { leadStatus: action.params.leadStatus },
        })
        // Audit, async non-blocking, mirrors other write paths.
        db.auditEntry
          .create({
            data: tenantData({
              userId,
              action: 'UPDATE',
              entityType: 'Lead',
              entityId: action.params.leadId,
              changes: {
                via: 'chatbot',
                leadStatus: action.params.leadStatus,
              },
            }),
          })
          .catch(() => {})
        return {
          success: true,
          message: `Lead status updated to "${action.params.leadStatus}".`,
          data: {
            leadId: action.params.leadId,
            path: `/leads/${action.params.leadId}`,
          },
        }
      }

      case 'update_lead_tier': {
        const db = createTenantPrisma(orgId)
        const lead = await db.lead.findFirst({
          where: { id: action.params.leadId, deletedAt: null },
        })
        if (!lead) {
          return { success: false, message: 'Lead not found.' }
        }
        await db.lead.update({
          where: { id: action.params.leadId },
          data: { tier: action.params.tier },
        })
        db.auditEntry
          .create({
            data: tenantData({
              userId,
              action: 'UPDATE',
              entityType: 'Lead',
              entityId: action.params.leadId,
              changes: {
                via: 'chatbot',
                tier: action.params.tier,
              },
            }),
          })
          .catch(() => {})
        return {
          success: true,
          message: `Lead tier updated to "${action.params.tier}".`,
          data: {
            leadId: action.params.leadId,
            path: `/leads/${action.params.leadId}`,
          },
        }
      }

      case 'enroll_in_cadence': {
        const { enrollLead: enrollLeadInCadence } = await import(
          '@/server/services/cadences'
        )
        const enrollment = await enrollLeadInCadence(
          action.params.cadenceId,
          action.params.leadId,
          userId,
          orgId,
        )
        return {
          success: true,
          message: 'Lead enrolled in cadence.',
          data: {
            enrollmentId: enrollment.id,
            cadenceId: action.params.cadenceId,
            path: `/cadences/${action.params.cadenceId}`,
          },
        }
      }

      case 'create_cadence': {
        // Reuse the same services the manual builder uses so tenant
        // scoping, validation, and contiguous step ordering stay
        // identical. The cadence is created as DRAFT (createCadence
        // always starts DRAFT) so the user reviews/activates it.
        const { createCadence, addStep } = await import(
          '@/server/services/cadences'
        )
        const cadence = (await createCadence(
          { name: action.params.name },
          userId,
          orgId,
        )) as { id: string }

        for (let i = 0; i < action.params.steps.length; i++) {
          const step = action.params.steps[i]
          await addStep(
            cadence.id,
            {
              actionType: step.actionType,
              stepOrder: i + 1, // service recomputes; satisfies the schema
              delayHours: step.delayHours ?? 0,
              subject: step.subject ?? null,
              body: step.body ?? null,
              taskTitle: step.taskTitle ?? null,
              taskDescription: step.taskDescription ?? null,
            },
            orgId,
          )
        }

        return {
          success: true,
          message: `Cadence "${action.params.name}" created as a draft with ${action.params.steps.length} step${action.params.steps.length === 1 ? '' : 's'}. Review and activate it when ready.`,
          data: {
            cadenceId: cadence.id,
            path: `/cadences/${cadence.id}`,
          },
        }
      }
    }
  } catch (error) {
    if (error instanceof AppError) {
      return { success: false, message: error.message }
    }
    console.error('[AI Service] executeChatAction failed:', error)
    return {
      success: false,
      message: 'Action failed. Please try again or perform it manually.',
    }
  }
}
