import { beforeEach,expect,it,vi } from 'vitest'
import { Prisma } from '@prisma/client'
const m=vi.hoisted(()=>({db:{user:{findUnique:vi.fn()},lead:{findFirst:vi.fn(),findMany:vi.fn()},task:{findMany:vi.fn()},receptionistCall:{findMany:vi.fn()},followUpSuggestion:{findMany:vi.fn(),createMany:vi.fn()},followUpSnooze:{findMany:vi.fn()},$queryRaw:vi.fn()},tx:vi.fn()}))
vi.mock('@/server/db/client',()=>({prisma:{$transaction:m.tx}}))
vi.mock('../access',()=>({getLeadAccessFilter:vi.fn(async()=>({deletedAt:null,assignedUserId:'actor'}))}))
import { listFollowUps } from '../follow-ups'
const row={id:'older',organizationId:'org',assigneeId:'actor',leadId:'lead',taskId:null,status:'PENDING',sourceType:'EMAIL',updatedAt:new Date('2026-11-05'),title:'Older quote'},lead={id:'lead',firstName:'Older',lastName:'Practice',email:'old@example.invalid'}
let queries:Prisma.Sql[]=[]
beforeEach(()=>{vi.resetAllMocks();queries=[];m.tx.mockImplementation(async fn=>fn(m.db));m.db.user.findUnique.mockResolvedValue({id:'actor',organizationMemberships:[{organizationId:'org'}],teamMemberships:[{role:{hierarchy:3,permissions:[{key:'leads:read'}]}}]});m.db.task.findMany.mockResolvedValue([]);m.db.receptionistCall.findMany.mockResolvedValue([]);m.db.followUpSuggestion.findMany.mockResolvedValue([row]);m.db.followUpSnooze.findMany.mockResolvedValue([]);m.db.lead.findMany.mockResolvedValue([lead]);m.db.$queryRaw.mockImplementation(async(q,...values)=>{const sql=Array.isArray(q)?Prisma.sql(q as unknown as TemplateStringsArray,...values):q;queries.push(sql);return sql.text.includes('WITH eligible')?[{id:row.id}]:[{id:'member'}]})})
it('filters the eligible result before the page limit while retaining authorized drafts independently',async()=>{
 const result=await listFollowUps('org','actor','PENDING',['open-draft'],{search:'Older quote',source:'EMAIL',dueOnly:true});expect(result.items[0].id).toBe('older');expect(result.canWrite).toBe(false);const query=queries.find(q=>q.text.includes('WITH eligible'))!;expect(query.values).toContain('Older quote');expect(query.values).toContain('EMAIL');expect(query.text.indexOf('strpos')).toBeLessThan(query.text.indexOf('LIMIT 100'));expect(query.text).toContain('"firstName"');expect(query.text).toContain('"lastName"');expect(query.text).toContain('l.email');expect(query.text).toContain('f.title');const retained=query.text.slice(query.text.indexOf('UNION'));expect(retained).not.toContain('strpos');expect(retained).not.toContain('until<=');expect(query.values).toContain('open-draft');expect(m.db.followUpSuggestion.createMany).not.toHaveBeenCalled()
})
it('rejects invalid filters before database access while retaining the existing default call contract',async()=>{
 await expect(listFollowUps('org','actor','PENDING',[],{source:'other'})).rejects.toBeDefined();expect(m.tx).not.toHaveBeenCalled();expect((await listFollowUps('org','actor')).items[0].id).toBe('older')
})
