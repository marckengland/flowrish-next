import { z } from 'zod'
import { KnowledgeLibrary } from '@/components/knowledge/knowledge-library'
import { hasPermission } from '@/server/auth/permissions'
import { requireSession } from '@/server/auth/session'

export default async function KnowledgePage({ searchParams }: { searchParams?: Promise<{ document?: string | string[] }> }): Promise<React.JSX.Element> {
  const session = await requireSession()
  if (!hasPermission(session.dbUser, 'admin:settings')) return <div className="rounded-lg border bg-card p-6"><h1 className="text-lg font-semibold">Knowledge library</h1><p className="mt-2 text-sm text-muted-foreground">You need organization settings permission to manage business knowledge.</p></div>
  const query = await searchParams
  const documentId = z.string().uuid().safeParse(query?.document)
  return <KnowledgeLibrary initialDocumentId={documentId.success ? documentId.data : undefined} />
}
