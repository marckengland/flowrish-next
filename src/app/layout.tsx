import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'

import { Providers } from '@/components/providers'
import { siteConfig } from '@/lib/site'
import { SETUP_HISTORY_SCRIPT } from '@/lib/receptionist-setup-history'

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
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.title,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
  keywords: [...siteConfig.keywords],
  applicationName: siteConfig.name,
  alternates: { canonical: '/' },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' as const },
  },
  openGraph: {
    type: 'website',
    siteName: siteConfig.name,
    title: siteConfig.title,
    description: siteConfig.description,
    url: siteConfig.url,
  },
  twitter: {
    card: 'summary_large_image',
    title: siteConfig.title,
    description: siteConfig.description,
  },
}

export const viewport: Viewport = {
  themeColor: '#1aa46e',
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
        <script dangerouslySetInnerHTML={{ __html: SETUP_HISTORY_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
