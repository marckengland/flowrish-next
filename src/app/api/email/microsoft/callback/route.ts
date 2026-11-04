import { NextRequest, NextResponse } from 'next/server'

import {
  consumeEmailOAuth,
  requireEmailOAuth,
} from '@/server/services/email-oauth-context'
import { requirePermission } from '@/server/auth/permissions'
import { requireSession } from '@/server/auth/session'
import { connectMicrosoft } from '@/server/services/microsoft-email'

/**
 * GET /api/email/microsoft/callback — Microsoft OAuth redirect handler.
 *
 * After the user authorizes access, Microsoft redirects here with `?code=…`.
 * We exchange the code for tokens (encrypted at rest) and render a page that
 * posts the result to the opener window and closes the popup — the same
 * pattern the Gmail connector uses.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const code = searchParams.get('code')
  const error =
    searchParams.get('error_description') ?? searchParams.get('error')

  const renderClosePage = (message: {
    type: string
    data?: unknown
    error?: string
  }) => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Outlook Connection</title></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
  <p id="status">Connecting Outlook…</p>
  <script>
    (function() {
      var msg = ${JSON.stringify(message).replace(/</g, '\\u003c')};
      try {
        if (window.opener) {
          window.opener.postMessage(msg, window.location.origin);
        }
      } catch (e) {}
      document.getElementById('status').textContent = msg.type === 'microsoft-oauth-success'
        ? 'Outlook connected. You can close this window.'
        : 'Connection failed: ' + (msg.error || 'Unknown error');
      setTimeout(function() { try { window.close(); } catch (e) {} }, 1500);
    })();
  </script>
</body>
</html>`
    return consumeEmailOAuth(
      new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
      'microsoft',
    )
  }

  if (error) {
    return renderClosePage({
      type: 'microsoft-oauth-error',
      error: 'Microsoft did not authorize this connection.',
    })
  }
  if (!code) {
    return renderClosePage({
      type: 'microsoft-oauth-error',
      error: 'No authorization code returned by Microsoft',
    })
  }

  try {
    const session = await requireSession()
    requirePermission(session.dbUser, 'leads:write')
    requireEmailOAuth(request, session, 'microsoft')
    const redirectUri = `${request.nextUrl.origin}/api/email/microsoft/callback`
    const result = await connectMicrosoft(
      code,
      session.dbUser.id,
      session.organizationId,
      redirectUri,
    )
    return renderClosePage({ type: 'microsoft-oauth-success', data: result })
  } catch {
    const message = 'Failed to connect Outlook. Start again in Settings.'
    return renderClosePage({ type: 'microsoft-oauth-error', error: message })
  }
}
