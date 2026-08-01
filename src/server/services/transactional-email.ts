import 'server-only'

/**
 * System-originated transactional email (waitlist confirmations, etc.).
 *
 * This is deliberately separate from `src/server/services/email.ts`, which
 * sends per-lead mail through a USER's connected Gmail/Microsoft mailbox and
 * requires a stored OAuth account. System emails have no such mailbox, so they
 * go out through Resend.
 *
 * Fully optional: if `RESEND_API_KEY` is not configured (e.g. local dev), the
 * sender is a no-op that returns false. Callers must treat delivery as
 * best-effort and never fail a request because email couldn't be sent.
 *
 * Reads process.env directly (not env.ts) so it stays optional and doesn't
 * force RESEND_* into the validated env schema.
 */

interface TransactionalEmail {
  to: string
  subject: string
  html: string
}

function getFrom(): string {
  return process.env.RESEND_FROM ?? 'Flowrish <onboarding@resend.dev>'
}

/**
 * Sends a transactional email via Resend. Returns true on success, false if
 * no provider is configured or the send failed. Never throws.
 */
export async function sendTransactionalEmail(
  email: TransactionalEmail,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(
      '[transactional-email] RESEND_API_KEY not set — skipping send (no-op).',
    )
    return false
  }

  try {
    // Imported lazily so the dependency is only loaded when actually sending.
    const { Resend } = await import('resend')
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from: getFrom(),
      to: email.to,
      subject: email.subject,
      html: email.html,
    })
    if (error) {
      console.error('[transactional-email] Resend error:', error)
      return false
    }
    return true
  } catch (err) {
    console.error('[transactional-email] Send failed:', err)
    return false
  }
}

/**
 * Waitlist confirmation email. Inline-styled to survive email clients.
 */
export function formatWaitlistConfirmationEmail(name?: string): {
  subject: string
  html: string
} {
  const greeting = name && name.trim() ? `Hi ${name.trim()},` : 'Hi there,'
  return {
    subject: "You're on the Flowrish waitlist 🌱",
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #111; margin: 0 0 16px;">You're on the list 🌱</h2>
        <p style="color: #444; font-size: 15px; line-height: 1.55;">${greeting}</p>
        <p style="color: #444; font-size: 15px; line-height: 1.55;">
          Thanks for your interest in <strong>Flowrish</strong> — the CRM that does the
          busywork so your team can sell. We're in private beta and letting teams in
          a batch at a time. We'll email you the moment a spot opens up.
        </p>
        <p style="color: #444; font-size: 15px; line-height: 1.55;">
          Nothing else to do for now. Sit tight and we'll be in touch.
        </p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px;">
          You're receiving this because you joined the waitlist at Flowrish. If this
          wasn't you, you can safely ignore this email.
        </p>
      </div>
    `,
  }
}
