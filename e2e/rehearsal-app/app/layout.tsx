import type { ReactNode } from 'react'
import '@/app/globals.css'
import { Providers } from './providers'
import { SETUP_HISTORY_SCRIPT } from '@/lib/receptionist-setup-history'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: SETUP_HISTORY_SCRIPT }} />
      </head>
      <body style={{ fontFamily: 'Arial, sans-serif' }}>
        <Providers>
          <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
