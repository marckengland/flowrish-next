import { NextRequest, NextResponse } from 'next/server'
import {
  consumeEmailOAuth,
  requireEmailOAuth,
} from '@/server/services/email-oauth-context'
import { requirePermission } from '@/server/auth/permissions'
import { requireSession } from '@/server/auth/session'
import { connectGmail } from '@/server/services/email'

/**
 * GET /api/email/callback — Google OAuth redirect handler for Gmail integration.
 *
 * After the user authorizes Gmail access, Google redirects here with `?code=...`.
 * This route exchanges the code for tokens via `connectGmail()` and renders an
 * HTML page that posts a message back to the opener window (the GmailConnect
 * popup pattern) and closes itself.
 *
 * Validates: Requirements 7.1
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  // Helper to render the close-popup HTML with a message
  const renderClosePage = (message: {
    type: string
    data?: unknown
    error?: string
  }) => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Gmail Connection</title></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
  <p id="status">Connecting Gmail...</p>
  <script>
    (function() {
      var msg = ${JSON.stringify(message).replace(/</g, '\\u003c')};
      try {
        if (window.opener) {
          window.opener.postMessage(msg, window.location.origin);
        }
      } catch (e) {}
      document.getElementById('status').textContent = msg.type === 'gmail-oauth-success'
        ? 'Gmail connected. You can close this window.'
        : 'Connection failed: ' + (msg.error || 'Unknown error');
      setTimeout(function() {
        try { window.close(); } catch (e) {}
      }, 1500);
    })();
  </script>
</body>
</html>`
    return consumeEmailOAuth(
      new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
      'gmail',
    )
  }

  if (error) {
    return renderClosePage({
      type: 'gmail-oauth-error',
      error: 'Google did not authorize this connection.',
    })
  }

  if (!code) {
    return renderClosePage({
      type: 'gmail-oauth-error',
      error: 'No authorization code returned by Google',
    })
  }

  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')
    requireEmailOAuth(request, session, 'gmail')
    const redirectUri = `${request.nextUrl.origin}/api/email/callback`
    const result = await connectGmail(
      code,
      session.dbUser.id,
      session.organizationId,
      redirectUri,
    )

    return renderClosePage({
      type: 'gmail-oauth-success',
      data: result,
    })
  } catch {
    const message = 'Failed to connect Gmail. Start again in Settings.'
    return renderClosePage({
      type: 'gmail-oauth-error',
      error: message,
    })
  }
}
