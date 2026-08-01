'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Mail } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Microsoft 365 / Outlook email setup instructions.
 *
 * Unlike calling (bring-your-own keys per org), email uses one Azure AD app
 * registered by the platform operator; each user then connects with one
 * click. This card gives the operator the exact, self-serve steps + links to
 * register that app and the required Microsoft Graph scopes + redirect URI.
 */
const GRAPH_SCOPES = ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Send']

export function MicrosoftSetupCard(): React.JSX.Element {
  const [redirectUri, setRedirectUri] = useState('/api/email/microsoft/callback')

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setRedirectUri(`${window.location.origin}/api/email/microsoft/callback`)
    }
  }, [])

  const steps: Array<{ text: string; href?: string; hrefLabel?: string; env?: string }> = [
    {
      text: 'In the Microsoft Entra admin center, open App registrations → New registration.',
      href: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
      hrefLabel: 'App registrations',
    },
    {
      text: `Add a Web redirect URI: ${redirectUri}`,
    },
    {
      text: 'Under API permissions, add these delegated Microsoft Graph scopes, then grant admin consent.',
    },
    {
      text: 'Under Certificates & secrets, create a client secret and copy its value.',
      env: 'MICROSOFT_CLIENT_SECRET',
    },
    {
      text: 'Copy the Application (client) ID from the app Overview.',
      env: 'MICROSOFT_CLIENT_ID',
    },
    {
      text: 'Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to your Flowrish environment and redeploy. A “Connect Outlook” button then appears here for every user.',
    },
  ]

  return (
    <Card className="max-w-[620px]">
      <CardHeader>
        <CardTitle>Microsoft 365 / Outlook</CardTitle>
        <Badge variant="outline" size="sm">
          Setup required
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-ai-subtle text-ai"
          >
            <Mail className="size-[18px]" />
          </span>
          <p className="text-[13px] text-muted-foreground">
            Sync and send from Outlook / Microsoft 365 mailboxes via Microsoft
            Graph. You register one Azure app for your workspace; each teammate
            then connects their own mailbox in one click. Uses OAuth — no
            passwords are stored.
          </p>
        </div>

        <ol className="flex flex-col gap-2.5">
          {steps.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-[12.5px]">
              <span
                aria-hidden="true"
                className="mt-0.5 flex size-[20px] shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] font-semibold tnum text-foreground"
              >
                {i + 1}
              </span>
              <span className="text-foreground/80">
                {s.text}
                {s.env && (
                  <code className="ml-1.5 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-brand-emphasis">
                    {s.env}
                  </code>
                )}
                {s.href && (
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-1.5 inline-flex items-center gap-0.5 font-medium text-brand-emphasis hover:underline"
                  >
                    {s.hrefLabel ?? 'Open'}
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                )}
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-3.5 rounded-[8px] border bg-background/60 p-3">
          <p className="mb-1.5 text-[12px] font-medium text-foreground">
            Required Microsoft Graph scopes (delegated):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {GRAPH_SCOPES.map((scope) => (
              <code
                key={scope}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
              >
                {scope}
              </code>
            ))}
          </div>
        </div>

        <a
          href="https://learn.microsoft.com/en-us/graph/auth-register-app-v2"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-brand-emphasis hover:underline"
        >
          Microsoft: register an app for Graph
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </CardContent>
    </Card>
  )
}
