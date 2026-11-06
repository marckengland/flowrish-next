import { beforeEach, expect, it, vi } from 'vitest'
import { Prisma } from '@prisma/client'
const m = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() }, lead: { findMany: vi.fn() }, task: { findMany: vi.fn() }, receptionistCall: { findMany: vi.fn() }, followUpSuggestion: { findMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() }, followUpSnooze: { findMany: vi.fn() }, $queryRaw: vi.fn() }, tx: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.tx } }))
vi.mock('../access', () => ({ getLeadAccessFilter: vi.fn(async () => ({ deletedAt: null, assignedUserId: 'actor' })) }))
import { listFollowUps } from '../follow-ups'
const now = new Date('2026-11-06T01:00:00Z'), id = '11111111-1111-4111-8111-111111111111'
const row = { id, organizationId: 'org', assigneeId: 'actor', leadId: 'lead', taskId: 'task', status: 'APPROVED', sourceType: 'EMAIL', title: 'Reviewed', createdAt: now, updatedAt: now }
const task = { id: 'task', leadId: 'lead', dueDate: new Date('2026-11-06T00:00:00Z'), isComplete: false, completedAt: null }
const actor = (hierarchy = 3) => ({ id: 'actor', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [{ role: { hierarchy, permissions: [{ key: 'leads:read' }] } }] })
let query: Prisma.Sql | undefined
beforeEach(() => {
 vi.resetAllMocks(); query = undefined; m.tx.mockImplementation(run => run(m.db)); m.db.user.findUnique.mockResolvedValue(actor()); m.db.lead.findMany.mockResolvedValue([{ id: 'lead', firstName: 'Practice', lastName: 'Clinic', email: 'lead@example.invalid' }]); m.db.task.findMany.mockImplementation(async args => args.select.dueDate ? [task] : []); m.db.followUpSuggestion.findMany.mockResolvedValue([row]); m.db.followUpSnooze.findMany.mockResolvedValue([])
 m.db.$queryRaw.mockImplementation(async (q, ...values) => { const sql = Prisma.sql(q as unknown as TemplateStringsArray, ...values); if (sql.text.includes('AS now')) return [{ now }]; if (sql.text.includes('WITH eligible')) { query = sql; return [{ id, createdAt: now, isPage: true, hasMore: false }] }; return [{ id: 'member' }] })
})
it('sorts Approved on the server and rechecks the complete deadline fingerprint without writes', async () => {
 let pageQuery:Prisma.Sql|undefined
 m.db.$queryRaw.mockImplementation(async (q,...values)=>{const sql=Array.isArray(q)?Prisma.sql(q as unknown as TemplateStringsArray,...values):q as Prisma.Sql;if(sql.text.includes('AS now'))return [{now}];if(sql.text.includes('jsonb_agg')){pageQuery=sql;return [{keys:[{id,createdAt:now.toISOString(),dueDate:task.dueDate.toISOString(),isPage:true,hasMore:true}],orderVersion:'a'.repeat(64)}]}if(sql.text.includes('sha256'))return [{orderVersion:'a'.repeat(64)}];return [{id:'member'}]})
 const result=await listFollowUps('org','actor','APPROVED',[],{taskOrder:'DUE_ASC'},{},true,true)
 expect(result.page?.orderVersion).toBe('a'.repeat(64));expect(result.page?.nextCursor).toBeTruthy();expect(result.items[0].taskProgress).toMatchObject({state:'OVERDUE'});expect(pageQuery?.text).toContain('NULLS LAST');expect(pageQuery?.values).toContain('actor');expect(pageQuery?.values).toContain('org')
 expect(m.db.followUpSuggestion.createMany).not.toHaveBeenCalled();expect(m.db.followUpSuggestion.updateMany).not.toHaveBeenCalled();expect(m.db.receptionistCall.findMany).not.toHaveBeenCalled()
})
it('rejects changes during locked metadata reads and rejects unsupported requests before accessing the database',async()=>{
 for(const args of [['PENDING',{},true,true],['APPROVED',undefined,true,true],['APPROVED',{},false,true],['APPROVED',{},true,false]] as const)await expect(listFollowUps('org','actor',args[0],[],{taskOrder:'DUE_ASC'},args[1],args[2],args[3])).rejects.toMatchObject({statusCode:400});expect(m.tx).not.toHaveBeenCalled()
 m.db.$queryRaw.mockImplementation(async(q,...values)=>{const sql=Array.isArray(q)?Prisma.sql(q as unknown as TemplateStringsArray,...values):q as Prisma.Sql;if(sql.text.includes('AS now'))return [{now}];if(sql.text.includes('jsonb_agg'))return [{keys:[{id,createdAt:now.toISOString(),dueDate:task.dueDate.toISOString(),isPage:true,hasMore:false}],orderVersion:'a'.repeat(64)}];if(sql.text.includes('sha256'))return [{orderVersion:'b'.repeat(64)}];return [{id:'member'}]})
 await expect(listFollowUps('org','actor','APPROVED',[],{taskOrder:'DUE_ASC'},{},true,true)).rejects.toMatchObject({statusCode:409,code:'FOLLOW_UP_ORDER_CHANGED'});expect(m.db.followUpSuggestion.updateMany).not.toHaveBeenCalled()
})
