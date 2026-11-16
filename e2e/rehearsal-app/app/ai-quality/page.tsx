'use client'
import { ChatbotSidebar } from '@/components/ai/chatbot-sidebar'
import { useLayoutStore } from '@/stores/layout'
export default function Page() {
  const setOpen = useLayoutStore(state => state.setChatOpen)
  return <><h1>Airish answer rehearsal</h1><p>Synthetic records only. No live provider or CRM actions.</p><button onClick={() => setOpen(true)}>Open Airish</button><ChatbotSidebar /></>
}
