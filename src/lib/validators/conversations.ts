import { z } from 'zod'
import { sanitizedString } from './common'

/**
 * Roles we persist for a conversation turn. Only the plain user /
 * assistant exchange is stored — system prompts and ephemeral action
 * cards are never written to the thread.
 */
export const conversationRoleEnum = z.enum(['user', 'assistant'])

export type ConversationRole = z.infer<typeof conversationRoleEnum>

/** Optional title supplied when creating or renaming a conversation. */
const conversationTitle = sanitizedString.pipe(
  z.string().trim().min(1, 'Title is required').max(120),
)

/** Schema for creating a conversation (title is optional, auto-derived). */
export const conversationCreateSchema = z.object({
  title: conversationTitle.optional(),
})

export type ConversationCreateInput = z.infer<typeof conversationCreateSchema>

/** Schema for renaming a conversation. */
export const conversationRenameSchema = z.object({
  title: conversationTitle,
})

export type ConversationRenameInput = z.infer<typeof conversationRenameSchema>
