import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => {
  const tx = { $queryRaw: vi.fn(), knowledgeDocument: { count: vi.fn(), create: vi.fn(), findFirst: vi.fn(), findFirstOrThrow: vi.fn(), updateMany: vi.fn() }, knowledgeChunk: { deleteMany: vi.fn(), createMany: vi.fn() }, auditEntry: { create: vi.fn() } }
  return { tx, member: vi.fn(), permissions: vi.fn(), transaction: vi.fn(), query: vi.fn(), documents: { findMany: vi.fn(), findFirst: vi.fn() } }
})
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: mocks.transaction, $queryRaw: mocks.query, organizationMember: { findUnique: mocks.member }, knowledgeDocument: mocks.documents } }))
vi.mock('@/server/auth/permissions', () => ({ getEffectivePermissions: mocks.permissions }))
import { createKnowledge, updateKnowledge, transitionKnowledge, getAirishKnowledge, getReceptionistKnowledge } from '../knowledge'
const document = { id: 'doc', organizationId: 'org', title: 'Service prices', category: 'PRICING', contentText: 'Repairs start at 500 pesos.', revision: 2, publishedTitle: 'Old price', publishedCategory: 'PRICING', publishedText: 'Old published text', publishedRevision: 1, publishedAt: new Date('2026-01-01'), archivedAt: null }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.member.mockResolvedValue({ userId: 'user' })
  mocks.permissions.mockResolvedValue(new Set(['admin:settings','leads:read']))
  mocks.transaction.mockImplementation(async (work: any) => work(mocks.tx))
  mocks.tx.knowledgeDocument.count.mockResolvedValue(0)
  mocks.tx.knowledgeDocument.findFirst.mockResolvedValue(document)
  mocks.tx.knowledgeDocument.findFirstOrThrow.mockResolvedValue(document)
  mocks.tx.knowledgeDocument.create.mockResolvedValue({ ...document, revision: 1 })
  mocks.tx.knowledgeDocument.updateMany.mockResolvedValue({ count: 1 })
  mocks.query.mockResolvedValue([])
})
describe('knowledge publication', () => {
  it('rejects oversized documents and an exhausted organization limit', async () => {
    await expect(createKnowledge('org','user',{title:'Title',category:'FAQ',contentText:'x'.repeat(100001)})).rejects.toThrow()
    mocks.tx.knowledgeDocument.count.mockResolvedValue(50)
    await expect(createKnowledge('org','user',{title:'Title',category:'FAQ',contentText:'Valid text'})).rejects.toThrow('50')
    expect(mocks.tx.knowledgeDocument.create).not.toHaveBeenCalled()
  })
  it('edits only the draft and preserves a previously approved published snapshot', async () => {
    await updateKnowledge('org','user','doc',{title:'New title',category:'PRICING',contentText:'Draft price',revision:2})
    const write = mocks.tx.knowledgeDocument.updateMany.mock.calls[0][0]
    expect(write.where).toMatchObject({ id:'doc', organizationId:'org', revision:2, archivedAt:null })
    expect(write.data).toMatchObject({ contentText:'Draft price', revision:{ increment:1 } })
    expect(write.data).not.toHaveProperty('publishedText')
    expect(write.data).not.toHaveProperty('receptionistApprovedRevision')
    expect(mocks.tx.knowledgeChunk.deleteMany).not.toHaveBeenCalled()
  })
  it('publishes the current revision atomically and clears previous public approval', async () => {
    await transitionKnowledge('org','user','doc',{action:'publish',revision:2})
    expect(mocks.tx.knowledgeDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data:expect.objectContaining({publishedText:'Repairs start at 500 pesos.',publishedRevision:3,receptionistApprovedRevision:null,revision:{increment:1}}) }))
    expect(mocks.tx.knowledgeChunk.createMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.arrayContaining([expect.objectContaining({organizationId:'org',documentId:'doc',revision:3,content:'Repairs start at 500 pesos.'})])}))
    expect(JSON.stringify(mocks.tx.auditEntry.create.mock.calls)).not.toContain('500 pesos')
  })
  it('requires explicit acknowledgment of the currently published snapshot before public approval', async () => {
    await expect(transitionKnowledge('org','user','doc',{action:'approve_receptionist',revision:2,publishedRevision:1,acknowledged:false})).rejects.toThrow()
    await expect(transitionKnowledge('org','user','doc',{action:'approve_receptionist',revision:2,publishedRevision:0,acknowledged:true})).rejects.toThrow()
    await transitionKnowledge('org','user','doc',{action:'approve_receptionist',revision:2,publishedRevision:1,acknowledged:true})
    expect(mocks.tx.knowledgeDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({receptionistApprovedRevision:1})}))
  })
  it.each(['unpublish','archive'] as const)('immediately removes retrieval chunks on %s without deleting document history', async (action) => {
    await transitionKnowledge('org','user','doc',{action,revision:2})
    expect(mocks.tx.knowledgeDocument.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({publishedAt:null,receptionistApprovedRevision:null})}))
    expect(mocks.tx.knowledgeChunk.deleteMany).toHaveBeenCalledWith({where:{documentId:'doc',organizationId:'org'}})
    expect(mocks.tx.knowledgeChunk.createMany).not.toHaveBeenCalled()
  })
  it('rejects a late mutation after another writer changes the revision', async () => {
    mocks.tx.knowledgeDocument.updateMany.mockResolvedValue({count:0})
    await expect(transitionKnowledge('org','user','doc',{action:'publish',revision:2})).rejects.toMatchObject({statusCode:409})
    expect(mocks.tx.knowledgeChunk.createMany).not.toHaveBeenCalled()
  })
  it('denies management to non-admins and departed members', async () => {
    mocks.permissions.mockResolvedValue(new Set(['leads:read']))
    await expect(createKnowledge('org','user',{title:'FAQ',category:'FAQ',contentText:'Text'})).rejects.toMatchObject({statusCode:403})
    mocks.member.mockResolvedValue(null)
    await expect(getAirishKnowledge('org','user','pricing')).rejects.toMatchObject({statusCode:403})
  })
})
describe('knowledge context retrieval', () => {
  it('does not search for empty or stopword-only questions', async () => {
    expect(await getReceptionistKnowledge('org','what is it')).toEqual({text:'',sources:[]})
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('deduplicates document citations and keeps the total context bounded', async () => {
    mocks.query.mockResolvedValue(Array.from({length:6},()=>({id:'doc',title:'Service guide',revision:4,category:'SERVICES',content:'x'.repeat(1500)})))
    const result=await getReceptionistKnowledge('org','services')
    expect(result.sources).toHaveLength(1)
    expect(result.text.length).toBeLessThanOrEqual(8000)
    expect(result.sources[0].excerpt.length).toBeLessThan(8000)
  })
  it('returns numbered bounded excerpts from published sources', async () => {
    mocks.query.mockResolvedValue([{id:'doc',title:'Services',revision:4,category:'SERVICES',content:'We repair bicycles.'}])
    const result = await getAirishKnowledge('org','user','bicycle repairs')
    expect(result.sources).toEqual([{id:'doc',title:'Services',revision:4,category:'SERVICES',excerpt:'We repair bicycles.'}])
    expect(result.text).toContain('[K1]')
    expect(result.text).toContain('We repair bicycles.')
    expect(result.text.length).toBeLessThanOrEqual(8000)
  })
})
