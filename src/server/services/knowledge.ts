import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '@/server/db/client'
import { getEffectivePermissions } from '@/server/auth/permissions'
import { AppError } from '@/lib/errors'

export interface KnowledgeContext { text: string; sources: Array<{ id: string; title: string; revision: number; category: string; excerpt: string }> }
const categorySchema = z.enum(['PRICING','SERVICES','FAQ','GENERAL'])
const fieldsSchema = z.object({ title: z.string().trim().min(1).max(160), category: categorySchema, contentText: z.string().trim().min(1).max(100000).refine((value) => !value.includes('\0'), 'Text must not contain NUL characters.'), sourceName: z.string().max(255).nullable().optional(), sourceMime: z.string().max(100).nullable().optional() })
const updateSchema = fieldsSchema.extend({ revision: z.number().int().positive() })
const transitionSchema = z.object({ action: z.enum(['publish','unpublish','approve_receptionist','revoke_receptionist','archive']), revision: z.number().int().positive(), publishedRevision: z.number().int().positive().optional(), acknowledged: z.boolean().optional() })

async function authorize(organizationId: string, userId: string, admin: boolean) {
  const member = await prisma.organizationMember.findUnique({ where: { userId_organizationId: { userId, organizationId } } })
  if (!member) throw new AppError('FORBIDDEN','Current organization membership is required.',403)
  const permissions = await getEffectivePermissions(userId,organizationId)
  if (admin ? !permissions.has('admin:settings') : !permissions.has('leads:read') && !permissions.has('admin:settings')) throw new AppError('FORBIDDEN','You do not have access to this knowledge library.',403)
}

export async function listKnowledge(organizationId: string, userId: string) {
  await authorize(organizationId,userId,true)
  return prisma.knowledgeDocument.findMany({ where: { organizationId }, select: { id:true,title:true,category:true,revision:true,publishedRevision:true,publishedAt:true,receptionistApprovedRevision:true,receptionistApprovedAt:true,archivedAt:true,sourceName:true,sourceMime:true,createdAt:true,updatedAt:true }, orderBy: [{ archivedAt:'asc' },{ updatedAt:'desc' }] })
}

export async function getKnowledge(organizationId: string, userId: string, id: string) {
  await authorize(organizationId,userId,true)
  const document = await prisma.knowledgeDocument.findFirst({ where:{id,organizationId} })
  if (!document) throw new AppError('NOT_FOUND','Knowledge document not found.',404)
  return document
}

export async function createKnowledge(organizationId: string, userId: string, input: z.input<typeof fieldsSchema>) {
  await authorize(organizationId,userId,true)
  const data = fieldsSchema.parse(input)
  return prisma.$transaction(async (tx) => {
    // Serialize the per-organization limit without a global lock or count race.
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id"=${organizationId} FOR UPDATE`
    if (await tx.knowledgeDocument.count({where:{organizationId,archivedAt:null}}) >= 50) throw new AppError('KNOWLEDGE_LIMIT','The library supports up to 50 active documents. Archive one before adding another.',400)
    const document = await tx.knowledgeDocument.create({data:{...data,organizationId,createdById:userId}})
    await tx.auditEntry.create({data:{organizationId,userId,action:'CREATE',entityType:'KnowledgeDocument',entityId:document.id,changes:{revision:document.revision}}})
    return document
  })
}

export async function updateKnowledge(organizationId: string, userId: string, id: string, input: z.input<typeof updateSchema>) {
  await authorize(organizationId,userId,true)
  const {revision,...data} = updateSchema.parse(input)
  return prisma.$transaction(async (tx) => {
    const written = await tx.knowledgeDocument.updateMany({where:{id,organizationId,revision,archivedAt:null},data:{...data,revision:{increment:1}}})
    if (!written.count) throw new AppError('KNOWLEDGE_CONFLICT','The document changed or was archived. Reload it before saving.',409)
    await tx.auditEntry.create({data:{organizationId,userId,action:'UPDATE',entityType:'KnowledgeDocument',entityId:id,changes:{revision:revision+1,operation:'save_draft'}}})
    return tx.knowledgeDocument.findFirstOrThrow({where:{id,organizationId}})
  })
}

function chunks(text: string) {
  const result: string[] = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start+1200,text.length)
    if (end < text.length) {
      const paragraph = text.lastIndexOf('\n',end)
      const space = text.lastIndexOf(' ',end)
      const split = paragraph > start+600 ? paragraph : space > start+600 ? space : end
      end = split
    }
    result.push(text.slice(start,end))
    if (end === text.length) break
    start = Math.max(start+1,end-120)
  }
  return result
}

export async function transitionKnowledge(organizationId: string, userId: string, id: string, input: z.input<typeof transitionSchema>) {
  await authorize(organizationId,userId,true)
  const values = transitionSchema.parse(input)
  return prisma.$transaction(async (tx) => {
    const document = await tx.knowledgeDocument.findFirst({where:{id,organizationId,archivedAt:null}})
    if (!document || document.revision !== values.revision) throw new AppError('KNOWLEDGE_CONFLICT','The document changed or was archived. Reload it before continuing.',409)
    const nextRevision = document.revision+1
    const now = new Date()
    const clearApproval = { receptionistApprovedRevision:null,receptionistApprovedAt:null,receptionistApprovedById:null }
    let data: Prisma.KnowledgeDocumentUpdateManyMutationInput = {revision:{increment:1}}
    if (values.action === 'publish') data = {...data,publishedTitle:document.title,publishedCategory:document.category,publishedText:document.contentText,publishedRevision:nextRevision,publishedAt:now,publishedById:userId,...clearApproval}
    if (values.action === 'unpublish') data = {...data,publishedAt:null,...clearApproval}
    if (values.action === 'archive') data = {...data,archivedAt:now,publishedAt:null,...clearApproval}
    if (values.action === 'revoke_receptionist') data = {...data,...clearApproval}
    if (values.action === 'approve_receptionist') {
      if (!values.acknowledged || !document.publishedAt || !document.publishedRevision || values.publishedRevision !== document.publishedRevision) throw new AppError('KNOWLEDGE_CONFLICT','Review and acknowledge the current published revision before approving it for callers.',409)
      data = {...data,receptionistApprovedRevision:document.publishedRevision,receptionistApprovedAt:now,receptionistApprovedById:userId}
    }
    const written = await tx.knowledgeDocument.updateMany({where:{id,organizationId,revision:values.revision,archivedAt:null},data})
    if (!written.count) throw new AppError('KNOWLEDGE_CONFLICT','The document changed while this action was running. Reload and try again.',409)
    if (['publish','unpublish','archive'].includes(values.action)) await tx.knowledgeChunk.deleteMany({where:{documentId:id,organizationId}})
    if (values.action === 'publish') await tx.knowledgeChunk.createMany({data:chunks(document.contentText).map((content,ordinal) => ({organizationId,documentId:id,revision:nextRevision,ordinal,content,title:document.title,category:document.category}))})
    await tx.auditEntry.create({data:{organizationId,userId,action:'UPDATE',entityType:'KnowledgeDocument',entityId:id,changes:{operation:values.action,revision:nextRevision,publishedRevision:values.action === 'publish' ? nextRevision : document.publishedRevision}}})
    return tx.knowledgeDocument.findFirstOrThrow({where:{id,organizationId}})
  })
}

const stopWords = new Set('a an and are as at be can could do does for from how i in is it me my of on or our please tell that the their them there these they this to us want was we what when where which who why will with would you your about'.split(' '))
function queryTerms(query: string) {
  return [...new Set((query.slice(0,2000).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((term) => term.length>=2 && term.length<=40 && !stopWords.has(term)))].slice(0,12).map((term) => `${term}:*`).join(' | ')
}

async function retrieve(organizationId: string, query: string, publicOnly: boolean, completeParagraphs = false): Promise<KnowledgeContext> {
  const terms = queryTerms(query)
  if (!terms) return {text:'',sources:[]}
  type Row = {id:string,title:string,revision:number,category:string,content:string,publishedText?:string|null}
  const approved = publicOnly ? Prisma.sql`AND d."receptionistApprovedRevision"=d."publishedRevision"` : Prisma.empty
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT d."id", c."title", c."revision", c."category", c."content"${completeParagraphs ? Prisma.sql`, d."publishedText"` : Prisma.empty}
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeDocument" d ON d."id"=c."documentId" AND d."organizationId"=c."organizationId"
    WHERE c."organizationId"=${organizationId} AND d."organizationId"=${organizationId}
      AND d."archivedAt" IS NULL AND d."publishedAt" IS NOT NULL
      AND c."revision"=d."publishedRevision" ${approved}
      AND c."searchVector" @@ to_tsquery('simple',${terms})
    ORDER BY ts_rank_cd(c."searchVector",to_tsquery('simple',${terms})) DESC,d."id",c."ordinal"
    LIMIT 6`)
  if (completeParagraphs) {
    // Chunks locate approved documents; only whole published paragraphs become public facts.
    const words = terms.split(' | ').map(term => term.slice(0, -2))
    const seen = new Set<string>()
    const candidates = rows.flatMap(row => {
      if (seen.has(row.id)) return []
      seen.add(row.id)
      return (row.publishedText ?? '').split(/\n\s*\n/).map(text => text.trim()).filter(Boolean).map(text => ({ row, text, score: words.filter(word => text.toLowerCase().includes(word)).length }))
    }).filter(item => item.score > 0).sort((left, right) => right.score - left.score)
    const sources: KnowledgeContext['sources'] = []
    let remainingBytes = 2200
    for (const { row, text } of candidates) {
      const size = Buffer.byteLength(text, 'utf8') + 2
      if (size > remainingBytes) continue
      remainingBytes -= size
      const source = sources.find(item => item.id === row.id)
      if (source) source.excerpt += `\n\n${text}`
      else sources.push({ id: row.id, title: row.title, revision: row.revision, category: row.category, excerpt: text })
    }
    return { text: sources.map(source => source.excerpt).join('\n\n'), sources }
  }
  const sources: KnowledgeContext['sources'] = []
  const sections: string[] = []
  let remaining = 8000
  for (const row of rows) {
    const existing = sources.findIndex((source) => source.id === row.id)
    if (existing>=0) {
      const source = sources[existing]
      const extra = row.content.slice(0,Math.max(0,remaining-2))
      if (extra) { source.excerpt += `\n\n${extra}`; sections[existing] += `\n\n${extra}`; remaining -= extra.length+2 }
      continue
    }
    const header = `[K${sources.length+1}] ${row.title} (revision ${row.revision}, ${row.category})\n`
    const excerpt = row.content.slice(0,Math.max(0,remaining-header.length-2))
    if (!excerpt) continue
    sources.push({id:row.id,title:row.title,revision:row.revision,category:row.category,excerpt})
    sections.push(header+excerpt)
    remaining -= header.length+excerpt.length+2
  }
  return {text:sections.join('\n\n'),sources}
}

export async function getAirishKnowledge(organizationId: string, userId: string, query: string): Promise<KnowledgeContext> {
  await authorize(organizationId,userId,false)
  return retrieve(organizationId,query,false)
}
export async function getReceptionistKnowledge(organizationId: string, query: string, options: { completeParagraphs?: boolean } = {}): Promise<KnowledgeContext> {
  return retrieve(organizationId,query,true,options.completeParagraphs)
}
