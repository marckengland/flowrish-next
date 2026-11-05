'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { EMAIL_NOTIFICATION_EVENT, emailNotificationCount, type EmailNotificationContext } from '@/lib/email-notifications'
import { emailNotificationData, emailNotificationHeaders } from '@/lib/email-notification-client'
import { WORKSPACE_EVENT } from '@/lib/workspace-context'
import { callbackNotificationCount } from '@/lib/callback-notifications'

export function NotificationBell({ scope = 'session', emailContext }: { scope?: string; emailContext?: EmailNotificationContext }): React.JSX.Element { return <BellState key={`${scope}:${emailContext?.organizationId ?? ''}:${emailContext?.userId ?? ''}`} emailContext={emailContext} /> }
function BellState({ emailContext }: { emailContext?: EmailNotificationContext }): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true, pending: AbortController | null = null, lastAttempt = -Infinity, refreshAgain = false
    async function load(explicit = false) {
      if (!active || pending || document.visibilityState !== 'visible' || !explicit && Date.now() - lastAttempt < 60000) return
      const controller = new AbortController(); pending = controller; lastAttempt = Date.now()
      try {
        const [response, emailResponse] = await Promise.all([fetch('/api/callback-notifications/count', { headers: { 'X-Flowrish-Response-Targets': '1' }, cache: 'no-store', signal: controller.signal }), emailContext ? fetch('/api/email-notifications/count', { headers: emailNotificationHeaders(emailContext), cache: 'no-store', signal: controller.signal }) : Promise.resolve(null)])
        if (!response.ok) throw new Error('Unavailable')
        const next = callbackNotificationCount.parse((await response.json()).data)
        const email = emailResponse && emailContext ? emailNotificationCount.parse(await emailNotificationData(emailResponse, emailContext)).unread : 0
        if (active && !controller.signal.aborted) { setCount(next.unread + email); setFailed(false) }
      } catch { if (active && !controller.signal.aborted) { setCount(null); setFailed(true) } }
      finally { if (pending === controller) pending = null; if (active && refreshAgain) { refreshAgain = false; void load(true) } }
    }
    const automatic = () => { void load() }, changed = () => { if (pending) refreshAgain = true; else void load(true) }
    const workspaceChanged = () => { active = false; pending?.abort(); setCount(null); setFailed(true) }
    window.addEventListener(WORKSPACE_EVENT, workspaceChanged); window.addEventListener(EMAIL_NOTIFICATION_EVENT, changed)
    void load(); const timer = window.setInterval(automatic, 60000)
    document.addEventListener('visibilitychange', automatic); window.addEventListener('focus', automatic); window.addEventListener('flowrish:callback-notifications-changed', changed)
    return () => { window.removeEventListener(WORKSPACE_EVENT, workspaceChanged); window.removeEventListener(EMAIL_NOTIFICATION_EVENT, changed); active = false; pending?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', automatic); window.removeEventListener('focus', automatic); window.removeEventListener('flowrish:callback-notifications-changed', changed) }
    // Context changes remount BellState before a response can cross accounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const label = failed ? 'Notifications, count unavailable' : count ? `Notifications, ${count} unread` : 'Notifications'
  return <Link href="/notifications" title={label} aria-label={label} className="relative flex size-[38px] items-center justify-center rounded-[10px] border bg-card text-foreground/60 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <Bell className="size-[17px]" aria-hidden="true" />
    {!!count && <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 min-w-4 rounded-full bg-brand px-1 text-center text-[10px] font-semibold leading-4 text-white">{count > 99 ? '99+' : count}</span>}
    {failed && <span aria-hidden="true" className="absolute right-0 top-0 size-2 rounded-full bg-amber-500" />}
  </Link>
}
