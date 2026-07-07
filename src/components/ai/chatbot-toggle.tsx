'use client'

import { MessagesSquare } from 'lucide-react'

import { useLayoutStore } from '@/stores/layout'

/**
 * Floating button that opens the AI chatbot sidebar from anywhere in
 * the dashboard. Stays hidden when the sidebar is already open so it
 * doesn't overlap the close button. Uses the same icon as the header
 * chat toggle so both entry points feel like the same affordance.
 */
export function ChatbotToggle(): React.JSX.Element | null {
  const open = useLayoutStore((s) => s.chatOpen)
  const setOpen = useLayoutStore((s) => s.setChatOpen)

  if (open) return null

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Open Flowrish Assistant"
      aria-label="Open Flowrish Assistant"
      className="fixed bottom-6 right-6 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all hover:scale-105 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <MessagesSquare className="size-5" aria-hidden="true" />
    </button>
  )
}
