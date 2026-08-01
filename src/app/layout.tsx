import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import { Providers } from '@/components/providers'

import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Flowrish CRM',
  description: 'Modern CRM built with Next.js and Supabase',
}

/**
 * Runs before hydration so the correct theme class is on `<html>` for
 * the very first paint. The product design is light by default; dark mode
 * is opt-in via the ThemeToggle and persisted to localStorage. We only
 * add the `dark` class when the user has explicitly chosen it — we do NOT
 * follow the OS `prefers-color-scheme`, so a dark-OS user still lands on
 * the intended light design until they toggle. Kept tiny and self-contained.
 */
const THEME_INIT_SCRIPT = `(function(){try{var k='flowrish:theme';var s=localStorage.getItem(k);if(s==='dark'){document.documentElement.classList.add('dark');}}catch(_e){}})();`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
