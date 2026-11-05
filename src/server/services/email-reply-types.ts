export interface ReplyMessage {
  externalId: string
  threadId: string | null
  fromEmail: string
  toEmail: string
  recipientEmails?: string[]
  subject: string
  bodyPreview: string | null
  sentAt: string
  headers?: Array<{ name: string; value: string }>
}

export function isHumanReply(message: ReplyMessage, mailbox: string, enrollment: { emailThreadId: string | null; enrolledAt: Date }): boolean {
  const from = message.fromEmail.trim().toLowerCase()
  const address = mailbox.trim().toLowerCase()
  const recipients = (message.recipientEmails ?? [message.toEmail]).map((s) => s.trim().toLowerCase())
  const time = new Date(message.sentAt).getTime()
  if (!from || from === address || !recipients.includes(address) || !message.threadId || message.threadId !== enrollment.emailThreadId || !Number.isFinite(time) || time <= enrollment.enrolledAt.getTime()) return false
  if (/^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)([+@._-]|$)/i.test(from)) return false
  const header = (name: string) => message.headers?.find((h) => h.name.toLowerCase() === name)?.value.trim().toLowerCase() ?? ''
  if (header('auto-submitted') && header('auto-submitted') !== 'no') return false
  if (header('x-autoreply') || header('x-autorespond') || /bulk|list|junk/.test(header('precedence'))) return false
  if (/multipart\/report|delivery-status|disposition-notification/.test(header('content-type'))) return false
  if (/^(automatic reply|auto.?reply|out of office|undeliverable|delivery status notification|returned mail)\b/i.test(message.subject)) return false
  return true
}
