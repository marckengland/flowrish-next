'use client'

import { aiChartSchema } from '@/lib/ai-chart'
import { KNOWLEDGE_HISTORY_MARKER } from '@/lib/knowledge-history'
import { ChatChart } from './chat-chart'

/**
 * Tiny markdown renderer covering the subset of formatting the assistant
 * realistically returns: headings, paragraphs, bullets, numbered lists,
 * fenced code blocks, inline code, bold, italics, and links. We avoid
 * pulling in `react-markdown` to keep the bundle thin —
 * `dangerouslySetInnerHTML` here only consumes a string we've fully
 * escaped and re-wrapped, so untrusted markup never reaches the DOM.
 */
export function ChatMessage({ source, streaming = false, hasSourceReferences = false }: { source: string; streaming?: boolean; hasSourceReferences?: boolean }): React.JSX.Element {
  const footer = source.lastIndexOf(KNOWLEDGE_HISTORY_MARKER)
  const visible = hasSourceReferences && footer >= 0 ? source.slice(0, footer) : source
  return <div className="min-w-0 space-y-2 text-[13px] leading-relaxed [overflow-wrap:anywhere]">
    {messageParts(visible).map((part, index) => {
      if (part.kind === 'markdown') return <div key={index} className="space-y-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-background/50 [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:underline [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold" dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }} />
      if (!part.closed && streaming) return <p key={index} className="text-muted-foreground">Preparing chart…</p>
      let value: unknown
      try { if (part.text.length <= 16000 && part.closed) value = JSON.parse(part.text) } catch { /* Incomplete or invalid chart data stays inert. */ }
      const result = aiChartSchema.safeParse(value)
      return result.success ? <ChatChart key={index} chart={result.data} /> : <div key={index} className="rounded-lg border p-2">
        <p>Chart unavailable. The supplied chart data is incomplete or unsupported.</p>
        <details className="mt-1"><summary className="cursor-pointer text-muted-foreground">View supplied chart data</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{part.text.slice(0, 16000)}</pre></details>
      </div>
    })}
  </div>
}

type MessagePart = { kind: 'markdown'; text: string } | { kind: 'chart'; text: string; closed: boolean }
function messageParts(source: string): MessagePart[] {
  const lines = source.split(/\r?\n/), parts: MessagePart[] = []
  let plain: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const fence = /^\s*(`{3,})([^`]*)$/.exec(lines[i])
    if (!fence) { plain.push(lines[i]); continue }
    const end = new RegExp('^\\s*`{' + fence[1].length + ',}\\s*$')
    const content: string[] = []; let j = i + 1
    while (j < lines.length && !end.test(lines[j])) content.push(lines[j++])
    if (fence[2].trim() === 'chart') {
      if (plain.length) parts.push({ kind: 'markdown', text: plain.join('\n') })
      plain = []; parts.push({ kind: 'chart', text: content.join('\n'), closed: j < lines.length })
    } else plain.push(...lines.slice(i, Math.min(j + 1, lines.length)))
    i = j
  }
  if (plain.length) parts.push({ kind: 'markdown', text: plain.join('\n') })
  return parts
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(text: string): string {
  // 1) escape everything, then 2) re-introduce a small allowed subset.
  const escaped = escapeHtml(text)
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
}

function renderMarkdown(source: string): string {
  const lines = source.split(/\r?\n/)
  const out: string[] = []
  let inUl = false
  let inOl = false
  let inCode = false
  let fenceLength = 3
  let codeLines: string[] = []
  let codeLang = ''

  function closeLists(): void {
    if (inUl) {
      out.push('</ul>')
      inUl = false
    }
    if (inOl) {
      out.push('</ol>')
      inOl = false
    }
  }

  let paragraphLines: string[] = []
  function flushParagraph(): void {
    if (paragraphLines.length === 0) return
    out.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`)
    paragraphLines = []
  }

  function flushCode(): void {
    // Code block contents are escaped verbatim — never run through the
    // inline pass — so markdown-like characters inside code render as
    // typed and no markup can leak in.
    const cls = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''
    out.push(
      `<pre><code${cls}>${escapeHtml(codeLines.join('\n'))}</code></pre>`,
    )
    codeLines = []
    codeLang = ''
  }

  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index]
    // Fenced code blocks take precedence over every other construct so
    // that markdown syntax inside a block is preserved verbatim.
    const fenceMatch = /^\s*(`{3,})([^`]*)$/.exec(rawLine)
    if (fenceMatch) {
      if (inCode) {
        if (fenceMatch[1].length < fenceLength || fenceMatch[2].trim()) { codeLines.push(rawLine); continue }
        flushCode()
        inCode = false
      } else {
        flushParagraph()
        closeLists()
        inCode = true
        fenceLength = fenceMatch[1].length
        codeLang = fenceMatch[2].trim()
      }
      continue
    }
    if (inCode) {
      codeLines.push(rawLine)
      continue
    }

    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      flushParagraph()
      closeLists()
      continue
    }
    const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
    const header = cells(line), divider = cells(lines[index + 1] ?? '')
    if (line.includes('|') && header.length >= 2 && header.length <= 12 && divider.length === header.length && divider.every(cell => /^:?-{3,}:?$/.test(cell))) {
      flushParagraph(); closeLists()
      const style = 'border-bottom:1px solid var(--border);padding:6px 8px;vertical-align:top;'
      const alignment = (column: number) => divider[column].endsWith(':') ? (divider[column].startsWith(':') ? 'center' : 'right') : 'left'
      out.push('<div role="region" aria-label="Answer table" tabindex="0" style="max-width:100%;overflow-x:auto;border:1px solid var(--border);border-radius:6px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>')
      header.forEach((cell, column) => out.push(`<th scope="col" style="${style}text-align:${alignment(column)}">${renderInline(cell)}</th>`))
      out.push('</tr></thead><tbody>'); index++
      while (index + 1 < lines.length && lines[index + 1].includes('|') && lines[index + 1].trim()) {
        const row = cells(lines[index + 1]); if (row.length !== header.length) break
        index++; out.push('<tr>')
        row.forEach((cell, column) => out.push(`<td style="${style}text-align:${alignment(column)}">${renderInline(cell)}</td>`))
        out.push('</tr>')
      }
      out.push('</tbody></table></div>'); continue
    }
    const headingMatch = /^\s*(#{1,6})\s+(.*)$/.exec(line)
    if (headingMatch) {
      flushParagraph()
      closeLists()
      const level = headingMatch[1].length
      out.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`)
      continue
    }
    const ulMatch = /^\s*[-*]\s+(.*)$/.exec(line)
    const olMatch = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ulMatch) {
      flushParagraph()
      if (inOl) {
        out.push('</ol>')
        inOl = false
      }
      if (!inUl) {
        out.push('<ul>')
        inUl = true
      }
      out.push(`<li>${renderInline(ulMatch[1])}</li>`)
      continue
    }
    if (olMatch) {
      flushParagraph()
      if (inUl) {
        out.push('</ul>')
        inUl = false
      }
      if (!inOl) {
        out.push('<ol>')
        inOl = true
      }
      out.push(`<li>${renderInline(olMatch[1])}</li>`)
      continue
    }
    closeLists()
    paragraphLines.push(line)
  }
  flushParagraph()
  closeLists()
  // Close an unterminated code fence gracefully (e.g. a streamed reply
  // that opened ``` but hasn't emitted the closing fence yet).
  if (inCode) flushCode()
  return out.join('')
}
