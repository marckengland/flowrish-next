'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'flowrish:theme'

type Theme = 'light' | 'dark'

/**
 * Toggle between light and dark mode.
 *
 * Persists the choice in localStorage and applies the `dark` class to
 * `<html>` so Tailwind's `dark:` variants pick it up. The initial paint
 * follows the user's system preference unless they've explicitly set
 * one — same convention the original Flowrish theme context used.
 *
 * Renders nothing until mounted to avoid an SSR / CSR mismatch (the
 * server can't know the user's preference).
 */
export function ThemeToggle(): React.JSX.Element | null {
  const [mounted, setMounted] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    setMounted(true)
    const saved = window.localStorage.getItem(STORAGE_KEY) as Theme | null
    const initial: Theme =
      saved
      ?? (window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light')
    applyTheme(initial)
    setTheme(initial)
  }, [])

  function toggle(): void {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    window.localStorage.setItem(STORAGE_KEY, next)
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
