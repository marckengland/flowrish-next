'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'flowrish:theme'

type Theme = 'light' | 'dark'

/**
 * Toggle between light and dark mode.
 *
 * The initial theme is applied by an inline script in `<head>` (see
 * `src/app/layout.tsx`) so the correct class is present on `<html>`
 * before React hydrates — this avoids a light-to-dark flash for
 * dark-mode users. This component simply reads the current state on
 * mount and drives subsequent toggles.
 */
export function ThemeToggle(): React.JSX.Element | null {
  const [mounted, setMounted] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    setMounted(true)
    // The inline `<head>` script has already set the `dark` class if
    // appropriate. Read it back so the toggle icon matches reality.
    const isDark = document.documentElement.classList.contains('dark')
    setTheme(isDark ? 'dark' : 'light')
  }, [])

  function toggle(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Storage can throw in private mode / sandboxed frames; the visual
      // toggle should still work even if we can't persist the choice.
    }
    setTheme(next)
  }

  if (!mounted) return null

  const label =
    theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {theme === 'dark' ? (
        <Sun className="size-4" aria-hidden="true" />
      ) : (
        <Moon className="size-4" aria-hidden="true" />
      )}
    </Button>
  )
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement
  if (theme === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}
