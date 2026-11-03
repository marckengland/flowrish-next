import type { ReactNode } from 'react'
import '@/app/globals.css'
import { Providers } from './providers'

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'Arial, sans-serif' }}>
        <Providers>
          <main className="mx-auto max-w-7xl p-4 sm:p-6">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
