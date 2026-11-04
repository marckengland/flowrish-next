'use client'
export async function prepareMailOAuth(
  popup: Window,
  provider: 'gmail' | 'microsoft',
  params: URLSearchParams,
) {
  const response = await fetch('/api/email/oauth/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider }),
  })
  const body = await response.json()
  if (!response.ok || typeof body?.data?.state !== 'string' || popup.closed)
    throw new Error('Connection could not start. Try again in this business.')
  params.set('state', body.data.state)
  const url =
    provider === 'gmail'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize'
  popup.location.href = `${url}?${params.toString()}`
}
