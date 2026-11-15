import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ db: { user: { findUnique: vi.fn() }, lead: { findFirst: vi.fn() }, task: { findFirst: vi.fn() }, followUpSuggestion: { findFirst: vi.fn() }, followUpSnooze: { findUnique: vi.fn() }, auditEntry: { findMany: vi.fn() }, $queryRaw: vi.fn() }, tx: vi.fn() }))
vi.mock('@/server/db/client', () => ({ prisma: { $transaction: m.tx } }))
vi.mock('../access', () => ({ getLeadAccessFilter: vi.fn(async () => ({ deletedAt: null, assignedUserId: 'actor' })) }))
import { listFollowUpHistory } from '../follow-up-history'
const id = '11111111-1111-4111-8111-111111111111', now = new Date('2026-11-05T02:00:00Z'), row = { id, organizationId: 'org', assigneeId: 'actor', leadId: 'lead', taskId: null, sourceType: 'EMAIL', status: 'PENDING', updatedAt: now }
const user = (write = true) => ({ id: 'actor', organizationMemberships: [{ organizationId: 'org' }], teamMemberships: [{ role: { hierarchy: 3, permissions: [{ key: 'leads:read' }, ...(write ? [{ key: 'leads:write' }] : [])] } }] })
const audit = (n: number, entityType: string, changes: unknown) => ({ id: `${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`, userId: 'actor', entityId: id, entityType, action: 'UPDATE', createdAt: new Date(now.getTime()-n*1000), changes })
beforeEach(() => { vi.resetAllMocks(); m.tx.mockImplementation(async fn => fn(m.db)); m.db.user.findUnique.mockResolvedValue(user()); m.db.lead.findFirst.mockResolvedValue({ id: 'lead' }); m.db.followUpSuggestion.findFirst.mockResolvedValue(row); m.db.followUpSnooze.findUnique.mockResolvedValue(null); m.db.$queryRaw.mockImplementation(async q => q.join('').includes('AS now') ? [{ now }] : [{ id: 'member' }]); m.db.auditEntry.findMany.mockResolvedValue([]) })
it('returns only safe action details from personal scoped audit records without writing', async () => {
  m.db.auditEntry.findMany.mockResolvedValue([audit(1,'FollowUpSuggestion',{status:'APPROVED',taskId:'private-task',body:'private-body'}),audit(2,'FollowUpSuggestion',{status:'DISMISSED'}),audit(3,'FollowUpSnooze',{action:'snooze',until:'2026-11-06T01:00:00.000Z',timeZone:'Asia/Manila',revision:1,private:'secret'}),audit(4,'FollowUpSnooze',{action:'wake',until:null,timeZone:'Asia/Manila',revision:2})]);
  const result = await listFollowUpHistory('org','actor',id,{}); expect(result.data.entries.map(entry=>entry.kind)).toEqual(['approved','dismissed','snoozed','woke']); expect(result.data.entries.every(entry=>entry.actor==='You')).toBe(true); expect(JSON.stringify(result)).not.toMatch(/private|secret|changes|userId|organizationId/); expect(result.canWrite).toBe(true)
  expect(m.db.auditEntry.findMany).toHaveBeenCalledWith({ where: { organizationId:'org',userId:'actor',entityId:id,action:'UPDATE',entityType:{in:['FollowUpSuggestion','FollowUpSnooze']} },orderBy:[{createdAt:'desc'},{id:'desc'}],skip:0,take:21,select:{id:true,entityType:true,changes:true,createdAt:true} })
})
it('explains elapsed snooze from the database clock without inventing a returned event', async () => {
  m.db.followUpSnooze.findUnique.mockResolvedValue({until:new Date('2026-11-05T01:00:00Z'),timeZone:'Asia/Manila'}); const due=await listFollowUpHistory('org','actor',id,{}); expect(due.data.current).toEqual({state:'due',until:'2026-11-05T01:00:00.000Z',timeZone:'Asia/Manila',checkedAt:now.toISOString()}); expect(due.data.entries).toEqual([])
  m.db.followUpSnooze.findUnique.mockResolvedValue({until:new Date('2026-11-06T01:00:00Z'),timeZone:'Asia/Manila'}); expect((await listFollowUpHistory('org','actor',id,{})).data.current.state).toBe('snoozed'); m.db.followUpSuggestion.findFirst.mockResolvedValue({...row,status:'APPROVED'}); expect((await listFollowUpHistory('org','actor',id,{})).data.current).toMatchObject({state:'approved',until:null,timeZone:null})
})
it('omits unknown or malformed legacy payloads and bounds scanned pages deterministically', async () => {
  m.db.auditEntry.findMany.mockResolvedValue([audit(1,'Lead',{status:'APPROVED'}),audit(2,'FollowUpSuggestion',{status:'PENDING'}),audit(3,'FollowUpSnooze',{action:'wake',until:'not-null',timeZone:'UTC'}),audit(4,'FollowUpSnooze',{action:'snooze',until:'invalid',timeZone:'UTC'})]); expect((await listFollowUpHistory('org','actor',id,{})).data.entries).toEqual([])
  m.db.auditEntry.findMany.mockResolvedValue(Array.from({length:21},(_,i)=>audit(i+1,'FollowUpSuggestion',{status:'DISMISSED'}))); const page=await listFollowUpHistory('org','actor',id,{page:2}); expect(page.data.entries).toHaveLength(20); expect(page.data.hasMore).toBe(true); expect(m.db.auditEntry.findMany.mock.lastCall?.[0]).toMatchObject({skip:20,take:21}); await expect(listFollowUpHistory('org','actor',id,{page:0})).rejects.toBeDefined(); await expect(listFollowUpHistory('org','actor',id,{extra:true})).rejects.toBeDefined()
})
it('requires current membership, lead access and current assignee before reading audit data', async () => {
  m.db.user.findUnique.mockResolvedValue(null); await expect(listFollowUpHistory('org','actor',id,{})).rejects.toMatchObject({statusCode:403}); m.db.user.findUnique.mockResolvedValue(user()); m.db.followUpSuggestion.findFirst.mockResolvedValue(null); await expect(listFollowUpHistory('org','actor',id,{})).rejects.toMatchObject({statusCode:404}); m.db.followUpSuggestion.findFirst.mockResolvedValue(row); m.db.lead.findFirst.mockResolvedValue(null); await expect(listFollowUpHistory('org','actor',id,{})).rejects.toMatchObject({statusCode:404}); expect(m.db.auditEntry.findMany).not.toHaveBeenCalled()
})
it('denies completed or reassigned pending work while allowing current owners to read reviewed history', async () => {
  m.db.followUpSuggestion.findFirst.mockResolvedValue({...row,sourceType:'CALL',taskId:'task'}); m.db.task.findFirst.mockResolvedValue(null); await expect(listFollowUpHistory('org','actor',id,{})).rejects.toMatchObject({statusCode:404}); expect(m.db.auditEntry.findMany).not.toHaveBeenCalled(); expect(m.db.task.findFirst.mock.calls[0][0].where).toMatchObject({assigneeId:'actor',isComplete:false,leadId:'lead',organizationId:'org'})
  m.db.followUpSuggestion.findFirst.mockResolvedValue({...row,status:'APPROVED',taskId:'task'}); m.db.task.findFirst.mockResolvedValue({id:'task',isComplete:true}); m.db.user.findUnique.mockResolvedValue(user(false)); expect((await listFollowUpHistory('org','actor',id,{})).canWrite).toBe(false); expect(m.db.task.findFirst.mock.lastCall?.[0].where).not.toHaveProperty('isComplete')
})
it('rechecks ownership and permissions after the audit read before disclosing results', async () => {
  m.db.auditEntry.findMany.mockImplementation(async()=>{m.db.followUpSuggestion.findFirst.mockResolvedValue(null);return [audit(1,'FollowUpSuggestion',{status:'APPROVED'})]}); await expect(listFollowUpHistory('org','actor',id,{})).rejects.toMatchObject({statusCode:404}); m.db.followUpSuggestion.findFirst.mockResolvedValue(row); m.db.auditEntry.findMany.mockImplementation(async()=>{m.db.user.findUnique.mockResolvedValue(null);return []}); await expect(listFollowUpHistory('org','actor',id,{})).rejects.toMatchObject({statusCode:403})
})
it('rejects a source or personal snooze revision that changes during an audit read',async()=>{
 m.db.auditEntry.findMany.mockImplementation(async()=>{m.db.followUpSuggestion.findFirst.mockResolvedValue({...row,status:'DISMISSED'});return []});await expect(listFollowUpHistory('org','actor',id,{})).rejects.toMatchObject({statusCode:409});m.db.followUpSuggestion.findFirst.mockResolvedValue(row);m.db.auditEntry.findMany.mockImplementation(async()=>{m.db.followUpSnooze.findUnique.mockResolvedValue({until:new Date('2026-11-06T01:00:00Z'),timeZone:'Asia/Manila',revision:1});return []});await expect(listFollowUpHistory('org','actor',id,{})).rejects.toMatchObject({statusCode:409})
})

const restoreProof={restore:{inputHash:'a'.repeat(64),version:'b'.repeat(64),taskId:'private-linked-task',restoredAt:'2026-10-01T01:00:00.000Z'}}
it('projects a restored action using audit time while keeping proof and linked task details private',async()=>{
 const entry=audit(1,'FollowUpSuggestion',{...restoreProof,private:'secret-body'});m.db.auditEntry.findMany.mockResolvedValue([entry]);m.db.user.findUnique.mockResolvedValue(user(false));const result=await listFollowUpHistory('org','actor',id,{})
 expect(result.data.entries).toEqual([{id:entry.id,kind:'restored',actor:'You',occurredAt:entry.createdAt.toISOString(),until:null,timeZone:null}]);expect(result.canWrite).toBe(false);expect(result.data.current.state).toBe('pending');expect(JSON.stringify(result)).not.toMatch(/private|secret|inputHash|version|taskId|restoredAt|organizationId|userId/);expect(m.db.auditEntry.findMany.mock.lastCall?.[0].where).toMatchObject({organizationId:'org',userId:'actor',entityId:id,entityType:{in:['FollowUpSuggestion','FollowUpSnooze']}})
})
it('does not invent a restoration or wake from incomplete legacy or wrong-entity records',async()=>{
 const malformed=[{restore:{}},{restore:{...restoreProof.restore,inputHash:'bad'}},{restore:{...restoreProof.restore,version:'bad'}},{restore:{...restoreProof.restore,taskId:''}},{restore:{...restoreProof.restore,restoredAt:'invalid'}},{restore:{inputHash:'a'.repeat(64),version:'b'.repeat(64),restoredAt:now.toISOString()}},{status:'PENDING'}]
 m.db.auditEntry.findMany.mockResolvedValue([...malformed.map((value,i)=>audit(i+1,'FollowUpSuggestion',value)),audit(19,'FollowUpSnooze',restoreProof),audit(20,'Lead',restoreProof)]);expect((await listFollowUpHistory('org','actor',id,{})).data.entries).toEqual([])
})
it('keeps restored history distinct from later current-state changes and bounded scanned pagination',async()=>{
 m.db.followUpSuggestion.findFirst.mockResolvedValue({...row,status:'DISMISSED'});m.db.auditEntry.findMany.mockResolvedValue(Array.from({length:21},(_,n)=>audit(n+1,'FollowUpSuggestion',restoreProof)));const result=await listFollowUpHistory('org','actor',id,{page:2});expect(result.data.current.state).toBe('dismissed');expect(result.data.entries).toHaveLength(20);expect(result.data.entries.every(entry=>entry.kind==='restored'&&entry.until===null&&entry.timeZone===null)).toBe(true);expect(result.data.hasMore).toBe(true);expect(m.db.auditEntry.findMany.mock.lastCall?.[0]).toMatchObject({skip:20,take:21})
})

it.each([
 ['approved','FollowUpSuggestion',['status'],'APPROVED'],
 ['dismissed','FollowUpSuggestion',['status'],'DISMISSED'],
 ['snoozed','FollowUpSnooze',['action'],'snooze'],
 ['woke','FollowUpSnooze',['action'],'wake'],
 ['restored','FollowUpSuggestion',['restore','inputHash'],null],
])('filters %s in the database before pagination with a scoped receipt',async(kind,entityType,path,value)=>{
 const result=await listFollowUpHistory('org','actor',id,{kind,page:3})
 expect(result.data).toMatchObject({kind,page:3,entries:[],hasMore:false})
 expect(m.db.auditEntry.findMany).toHaveBeenCalledWith({where:{organizationId:'org',userId:'actor',entityId:id,action:'UPDATE',entityType:{in:['FollowUpSuggestion','FollowUpSnooze']},AND:{entityType,changes:{path,...(kind==='restored'?{string_starts_with:''}:{equals:value})}}},orderBy:[{createdAt:'desc'},{id:'desc'}],skip:40,take:21,select:{id:true,entityType:true,changes:true,createdAt:true}})
 expect(m.db.followUpSuggestion.findFirst).toHaveBeenCalledTimes(2)
})
it('retains projection validation and restore precedence without exposing wrong-kind or malformed candidates',async()=>{
 m.db.auditEntry.findMany.mockResolvedValue([audit(1,'FollowUpSuggestion',{...restoreProof,status:'APPROVED'}),audit(2,'FollowUpSuggestion',{status:'APPROVED'}),audit(3,'FollowUpSuggestion',{restore:{inputHash:'bad'}})])
 const result=await listFollowUpHistory('org','actor',id,{kind:'approved'});expect(result.data.entries.map(entry=>entry.kind)).toEqual(['approved']);expect(result.data.current.state).toBe('pending');expect(JSON.stringify(result)).not.toMatch(/inputHash|version|restoredAt|private/)
 await expect(listFollowUpHistory('org','actor',id,{kind:'unknown'})).rejects.toBeDefined();await expect(listFollowUpHistory('org','actor',id,{kind:''})).rejects.toBeDefined();expect((await listFollowUpHistory('org','actor',id,{})).data).toMatchObject({kind:'all'})
})
it('uses stable scoped keysets instead of offsets and returns the exact request position',async()=>{
 const rows=Array.from({length:21},(_,n)=>audit(n+1,'FollowUpSuggestion',{status:'APPROVED'}));m.db.auditEntry.findMany.mockResolvedValue(rows)
 const first=await listFollowUpHistory('org','actor',id,{kind:'approved'},true);expect(first.data.paging?.cursor).toBeTruthy();expect(first.data.paging?.nextCursor).toBeTruthy();expect(m.db.auditEntry.findMany.mock.lastCall?.[0]).not.toHaveProperty('skip');expect(first.data.entries.map(entry=>entry.id)).toEqual(rows.slice(0,20).map(row=>row.id))
 const next=await listFollowUpHistory('org','actor',id,{kind:'approved',page:2,cursor:first.data.paging!.nextCursor},true),query=m.db.auditEntry.findMany.mock.lastCall?.[0]
 expect(next.data.paging?.cursor).toBe(first.data.paging!.nextCursor);expect(query).not.toHaveProperty('skip');expect(query.where).toMatchObject({organizationId:'org',userId:'actor',entityId:id,AND:[{entityType:'FollowUpSuggestion',changes:{path:['status'],equals:'APPROVED'}},{OR:[{createdAt:{lt:rows[0].createdAt}},{createdAt:rows[0].createdAt,id:{lte:rows[0].id}}]},{OR:[{createdAt:{lt:rows[19].createdAt}},{createdAt:rows[19].createdAt,id:{lt:rows[19].id}}]}]})
 await expect(listFollowUpHistory('org','actor',id,{kind:'restored',page:2,cursor:first.data.paging!.nextCursor},true)).rejects.toMatchObject({statusCode:409})
 await expect(listFollowUpHistory('org','actor',id,{page:2},true)).rejects.toMatchObject({statusCode:400});await expect(listFollowUpHistory('org','actor',id,{page:2,cursor:first.data.paging!.nextCursor})).rejects.toMatchObject({statusCode:400})
 expect((await listFollowUpHistory('org','actor',id,{})).data).not.toHaveProperty('paging')
})
it('advances stable boundaries past malformed rows and freezes an empty first history',async()=>{
 m.db.auditEntry.findMany.mockResolvedValue(Array.from({length:21},(_,n)=>audit(n+1,'FollowUpSuggestion',{status:'PENDING'})))
 const first=await listFollowUpHistory('org','actor',id,{},true);expect(first.data.entries).toEqual([]);expect(first.data.hasMore).toBe(true);expect(first.data.paging?.nextCursor).toBeTruthy()
 m.db.auditEntry.findMany.mockResolvedValue([]);const empty=await listFollowUpHistory('org','actor',id,{},true);expect(empty.data.hasMore).toBe(false);expect(empty.data.paging?.nextCursor).toBeNull();await listFollowUpHistory('org','actor',id,{cursor:empty.data.paging!.cursor},true);expect(m.db.auditEntry.findMany.mock.lastCall?.[0].where.AND).toContainEqual({id:{in:[]}})
})
const dateQuery={from:'2026-11-01',to:'2026-11-05',timeZone:'Asia/Manila'}
it('filters full saved dates before stable pagination and echoes the exact canonical window',async()=>{
 m.db.auditEntry.findMany.mockResolvedValue(Array.from({length:21},(_,n)=>audit(n+1,'FollowUpSuggestion',{status:'APPROVED'})))
 const result=await listFollowUpHistory('org','actor',id,{...dateQuery,kind:'approved'},true,true)
 expect(result.data.range).toEqual({...dateQuery,start:'2026-10-31T16:00:00.000Z',end:'2026-11-05T16:00:00.000Z'});expect(result.data.current.state).toBe('pending');expect(result.data.entries).toHaveLength(20)
 expect(m.db.auditEntry.findMany.mock.lastCall?.[0]).toMatchObject({where:{organizationId:'org',userId:'actor',entityId:id,AND:[{entityType:'FollowUpSuggestion',changes:{path:['status'],equals:'APPROVED'}},{createdAt:{gte:new Date('2026-10-31T16:00:00.000Z'),lt:new Date('2026-11-05T16:00:00.000Z')}}]},take:21});expect(m.db.auditEntry.findMany.mock.lastCall?.[0]).not.toHaveProperty('skip')
 await expect(listFollowUpHistory('org','actor',id,{...dateQuery,to:'2026-11-06',kind:'approved',page:2,cursor:result.data.paging!.nextCursor},true,true)).rejects.toMatchObject({statusCode:409})
 expect((await listFollowUpHistory('org','actor',id,{},true,true)).data.range).toBeNull();expect((await listFollowUpHistory('org','actor',id,{},true)).data).not.toHaveProperty('range')
})
it('rejects invalid or unnegotiated date queries before reading private audit data',async()=>{
 for(const raw of [{...dateQuery,to:'2026-10-31'},{...dateQuery,to:'2026-02-30'},{...dateQuery,timeZone:'Invalid/Zone'},{from:dateQuery.from},{...dateQuery,timeZone:'America/Havana',from:'2026-11-01',to:'2026-11-01'}])await expect(listFollowUpHistory('org','actor',id,raw,true,true)).rejects.toMatchObject({statusCode:400})
 await expect(listFollowUpHistory('org','actor',id,dateQuery,true)).rejects.toMatchObject({statusCode:400});await expect(listFollowUpHistory('org','actor',id,dateQuery,false,true)).rejects.toMatchObject({statusCode:400});expect(m.db.auditEntry.findMany).not.toHaveBeenCalled()
})
