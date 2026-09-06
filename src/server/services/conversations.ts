import { createTenantPrisma } from '@/server/db/middleware'
import { tenantData } from '@/server/db/types'
import { AppError } from '@/lib/errors'
import type { ConversationRole } from '@/lib/validators/conversations'

/**
 * Conversation persistence for the Airish AI assistant.
 *
 * Conversations are scoped to a single user within an organization. The
 * tenant Prisma client injects `organizationId` automatically; we add an
 * explicit `userId` filter on every read/mutation so one member can never
 * touch another member's threads even within the same org.
 *
 * Only the plain user/assistant text exchange is stored. Ephemeral action
 * proposals (and their confirm/reject state) are deliberately NOT
 * persisted, so a reloaded thread can't re-trigger a stale action.
 */

/** A lightweight conversation row for list views. */
export interface ConversationSummary {
  id: string
  title: string | null
  createdAt: Date
  updatedAt: Date
}

/** A single persisted turn. */
export interface ConversationMessageDto {
  id: string
  role: string
  content: string
  createdAt: Date
}

/** A conversation with its ordered messages. */
export interface ConversationDetail extends ConversationSummary {
  messages: ConversationMessageDto[]
}

/** How many prior turns to replay to the model as context. */
const HISTORY_LIMIT = 20

/** Longest auto-derived title (from the first user message). */
const TITLE_MAX = 80

/**
 * Lists a user's conversations, most-recently-updated first. Messages are
 * not included — this backs a compact thread picker.
 */
export async function listConversations(
  userId: string,
  orgId: string,
  limit = 50,
): Promise<ConversationSummary[]> {
  const db = createTenantPrisma(orgId)
  return db.conversation.findMany({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  })
}

/**
 * Fetches one conversation (with messages ordered oldest→newest) for the
 * owning user. Throws 404 if it doesn't exist or belongs to someone else.
 */
export async function getConversation(
  id: string,
  userId: string,
  orgId: string,
): Promise<ConversationDetail> {
  const db = createTenantPrisma(orgId)
  const conversation = await db.conversation.findFirst({
    where: { id, userId },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, createdAt: true },
      },
    },
  })

  if (!conversation) {
    throw new AppError('CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
  }

  return conversation
}

/**
 * Returns the user's most recent conversation with messages, or null when
 * they have none. Used to restore the thread after a reload.
 */
export async function getLatestConversation(
  userId: string,
  orgId: string,
): Promise<ConversationDetail | null> {
  const db = createTenantPrisma(orgId)
  const latest = await db.conversation.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })
  if (!latest) return null
  return getConversation(latest.id, userId, orgId)
}

/**
 * Creates an empty conversation for the user. `title` is optional; when
 * omitted it stays null until the first user message derives one.
 */
export async function createConversation(
  userId: string,
  orgId: string,
  title?: string,
): Promise<ConversationSummary> {
  const db = createTenantPrisma(orgId)
  return db.conversation.create({
    data: tenantData({ userId, title: title ?? null }),
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  })
}

/**
 * Verifies a conversation belongs to the user, throwing 404 otherwise.
 * Returns its id and current title (cheap — no messages loaded).
 */
async function requireOwnedConversation(
  id: string,
  userId: string,
  orgId: string,
): Promise<{ id: string; title: string | null }> {
  const db = createTenantPrisma(orgId)
  const conversation = await db.conversation.findFirst({
    where: { id, userId },
    select: { id: true, title: true },
  })
  if (!conversation) {
    throw new AppError('CONVERSATION_NOT_FOUND', 'Conversation not found', 404)
  }
  return conversation
}

/**
 * Appends a message to a conversation the user owns and touches the
 * parent's `updatedAt`. The first user message also seeds the title when
 * none is set yet. Returns the created message.
 */
export async function appendMessage(
  conversationId: string,
  role: ConversationRole,
  content: string,
  userId: string,
  orgId: string,
): Promise<ConversationMessageDto> {
  const conversation = await requireOwnedConversation(conversationId, userId, orgId)
  const db = createTenantPrisma(orgId)

  const message = await db.conversationMessage.create({
    data: tenantData({ conversationId, role, content }),
    select: { id: true, role: true, content: true, createdAt: true },
  })

  // Touch updatedAt so recency ordering reflects the new activity, and
  // seed a title from the first user turn when the thread is still blank.
  const shouldSetTitle = role === 'user' && !conversation.title
  await db.conversation.update({
    where: { id: conversationId },
    data: {
      updatedAt: new Date(),
      ...(shouldSetTitle ? { title: deriveTitle(content) } : {}),
    },
  })

  return message
}

/**
 * Returns the last {@link HISTORY_LIMIT} turns of a conversation as
 * role/content pairs to replay to the model. Ownership is enforced.
 */
export async function getConversationHistory(
  conversationId: string,
  userId: string,
  orgId: string,
): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  await requireOwnedConversation(conversationId, userId, orgId)
  const db = createTenantPrisma(orgId)

  // Grab the newest N in desc order, then flip to chronological.
  const recent = await db.conversationMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
    select: { role: true, content: true },
  })

  return recent
    .reverse()
    .filter((m): m is { role: 'user' | 'assistant'; content: string } =>
      m.role === 'user' || m.role === 'assistant',
    )
}

/** Renames a conversation the user owns. */
export async function renameConversation(
  id: string,
  title: string,
  userId: string,
  orgId: string,
): Promise<ConversationSummary> {
  await requireOwnedConversation(id, userId, orgId)
  const db = createTenantPrisma(orgId)
  return db.conversation.update({
    where: { id },
    data: { title },
    select: { id: true, title: true, createdAt: true, updatedAt: true },
  })
}

/**
 * Deletes a conversation (and, via cascade, its messages). Idempotent
 * from the caller's view: a missing/other-user thread yields 404.
 */
export async function deleteConversation(
  id: string,
  userId: string,
  orgId: string,
): Promise<{ id: string }> {
  await requireOwnedConversation(id, userId, orgId)
  const db = createTenantPrisma(orgId)
  await db.conversation.delete({ where: { id } })
  return { id }
}

/** Collapses whitespace and clips the first user message into a title. */
function deriveTitle(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= TITLE_MAX) return normalized
  return `${normalized.slice(0, TITLE_MAX).trimEnd()}…`
}
