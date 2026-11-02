import 'server-only'
import { z } from 'zod'
import { getReceptionistKnowledge } from './knowledge'
import { generateWebsiteReceptionistText } from './ai'

function clippedHistory(value: string): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(new TextEncoder().encode(value).slice(0, 500)).replace(/\uFFFD$/, '')
}

export async function generateWebsiteReceptionistAnswer(organizationId: string, businessName: string, question: string, history: string[]): Promise<string> {
  const callerHistory = history.slice(-2).map(clippedHistory)
  const context = await getReceptionistKnowledge(organizationId, [...callerHistory, question].join('\n'), { completeParagraphs: true })
  const paragraphs: string[] = []
  let bytes = 0
  for (const source of context.sources) {
    for (const paragraph of source.excerpt.split(/\n\s*\n/)) {
      const text = paragraph.trim(), size = new TextEncoder().encode(text).length + 2
      // Preserve complete paragraphs so truncation cannot turn a price into a different amount.
      if (text && bytes + size <= 2200) { paragraphs.push(text); bytes += size }
    }
  }
  if (!paragraphs.length) return 'I do not have approved information for that question. Please use the callback form so the team can review your request.'
  const reply = await generateWebsiteReceptionistText(organizationId, businessName, question, callerHistory, paragraphs.join('\n\n'))
  return z.string().trim().min(1).max(600).parse(reply)
}
