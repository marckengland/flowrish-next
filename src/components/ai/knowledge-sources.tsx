'use client'

export interface KnowledgeReference {
  id: string
  title: string
  revision: number
  category: string
}

export function KnowledgeSources({ sources }: { sources: readonly KnowledgeReference[] }): React.JSX.Element | null {
  if (!sources.length) return null
  return (
    <ul aria-label="Knowledge references" className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
      {sources.slice(0, 6).map((source, index) => <li key={source.id} className="max-w-full break-words rounded-md border bg-card px-2 py-1">[K{index + 1}] {source.title} · revision {source.revision}</li>)}
    </ul>
  )
}
