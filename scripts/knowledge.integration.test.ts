import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync,readdirSync } from 'node:fs'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { PrismaClient } from '@prisma/client'

const container=`flowrish-knowledge-${process.pid}`
let db:PrismaClient
let service:typeof import('../src/server/services/knowledge')
let databaseStarted=false
const orgId=randomUUID(),otherOrgId=randomUUID(),userId=randomUUID(),viewerId=randomUUID(),otherUserId=randomUUID()
function docker(...args:string[]){return execFileSync('docker',args,{encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}
function sql(query:string){return execFileSync('docker',['exec','-i',container,'psql','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','postgres','-At'],{input:query,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()}
beforeAll(async()=>{
 docker('run','--pull=never','--rm','-d','--name',container,'-e','POSTGRES_HOST_AUTH_METHOD=trust','-p','127.0.0.1::5432','pgvector/pgvector:pg16');databaseStarted=true
 let ready=false
 for(let attempt=0;attempt<100;attempt++){try{docker('exec',container,'pg_isready','-h','127.0.0.1','-U','postgres');ready=true;break}catch{await new Promise(resolve=>setTimeout(resolve,100))}}
 if(!ready)throw new Error('Disposable PostgreSQL did not become ready.')
 const port=docker('port',container,'5432/tcp').split(':').at(-1)
 process.env.DATABASE_URL=`postgresql://postgres@127.0.0.1:${port}/postgres`;process.env.DIRECT_URL=process.env.DATABASE_URL
 sql('CREATE ROLE anon; CREATE ROLE authenticated;')
 for(const name of readdirSync('prisma/migrations').sort()){if(name!=='migration_lock.toml')sql(readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8'))}
 ;({prisma:db}=await import('../src/server/db/client'));service=await import('../src/server/services/knowledge')
 await db.organization.createMany({data:[{id:orgId,name:'Knowledge verification',slug:orgId},{id:otherOrgId,name:'Untouched knowledge',slug:otherOrgId}]})
 for(const [id,organizationId,admin] of [[userId,orgId,true],[viewerId,orgId,false],[otherUserId,otherOrgId,true]] as const){
  await db.user.create({data:{id,authId:randomUUID(),name:'Knowledge reviewer',email:`${id}@example.invalid`}})
  await db.organizationMember.create({data:{organizationId,userId:id}})
  const role=await db.role.create({data:{organizationId,name:admin?'Library admin':'Library reader',hierarchy:admin?1:3,permissions:{create:admin?[{key:'admin:settings'},{key:'leads:read'}]:[{key:'leads:read'}]}}})
  const team=await db.team.create({data:{organizationId,name:`Knowledge team ${id}`}})
  await db.teamMember.create({data:{userId:id,teamId:team.id,roleId:role.id}})
 }
})
afterAll(async()=>{if(db)await db.$disconnect();if(databaseStarted)docker('stop',container)})
async function draft(title='Bicycle repair prices',text='Bicycle repair costs 500 pesos.',category:'PRICING'|'SERVICES'|'FAQ'|'GENERAL'='PRICING',organizationId=orgId,actor=userId){return service.createKnowledge(organizationId,actor,{title,category,contentText:text})}
async function publish(item:Awaited<ReturnType<typeof draft>>,organizationId=orgId,actor=userId){return service.transitionKnowledge(organizationId,actor,item.id,{action:'publish',revision:item.revision})}
async function approve(item:Awaited<ReturnType<typeof draft>>,organizationId=orgId,actor=userId){return service.transitionKnowledge(organizationId,actor,item.id,{action:'approve_receptionist',revision:item.revision,publishedRevision:item.publishedRevision!,acknowledged:true})}

describe('knowledge library on disposable PostgreSQL',()=>{
 it('applies full migrations and denies direct browser-role access to both tables',()=>{
  expect(sql(`SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('KnowledgeDocument','KnowledgeChunk') AND rowsecurity`)).toBe('2')
  expect(sql(`SELECT has_table_privilege('anon','"KnowledgeDocument"','SELECT'),has_table_privilege('authenticated','"KnowledgeChunk"','TRUNCATE')`)).toBe('f|f')
 })
 it('keeps drafts private, publishes exact snapshots, and requires separate current-revision acknowledgment for public callers',async()=>{
  const item=await draft('Repair fee policy','Our bicycle service fee is 573 pesos.')
  expect(await service.getAirishKnowledge(orgId,viewerId,'573')).toEqual({text:'',sources:[]})
  const published=await publish(item)
  expect((await service.getAirishKnowledge(orgId,viewerId,'573')).text).toContain('573 pesos')
  expect(await service.getReceptionistKnowledge(orgId,'573')).toEqual({text:'',sources:[]})
  await expect(service.transitionKnowledge(orgId,userId,item.id,{action:'approve_receptionist',revision:published.revision,publishedRevision:published.publishedRevision!,acknowledged:false})).rejects.toThrow()
  await expect(service.transitionKnowledge(orgId,userId,item.id,{action:'approve_receptionist',revision:published.revision,publishedRevision:published.publishedRevision!+1,acknowledged:true})).rejects.toThrow()
  const approved=await approve(published)
  expect(approved.receptionistApprovedRevision).toBe(published.publishedRevision)
  expect((await service.getReceptionistKnowledge(orgId,'573')).text).toContain('573 pesos')
  const edited=await service.updateKnowledge(orgId,userId,item.id,{revision:approved.revision,title:'Repair fee draft',category:'PRICING',contentText:'New unpublished cost is 987 pesos.'})
  expect(edited.publishedText).toBe('Our bicycle service fee is 573 pesos.')
  expect((await service.getReceptionistKnowledge(orgId,'573')).text).toContain('573 pesos')
  expect((await service.getAirishKnowledge(orgId,viewerId,'987')).sources).toHaveLength(0)
  const republished=await publish(edited)
  expect(republished.receptionistApprovedRevision).toBeNull()
  expect((await service.getAirishKnowledge(orgId,viewerId,'987')).text).toContain('987 pesos')
  expect((await service.getReceptionistKnowledge(orgId,'987')).sources).toHaveLength(0)
  const audits=await db.auditEntry.findMany({where:{entityId:item.id},select:{changes:true}})
  expect(JSON.stringify(audits)).not.toMatch(/573 pesos|987 pesos/)
 })
 it('rejects stale and concurrent edits so only one writer can publish a revision',async()=>{
  const item=await draft('Concurrent manual','Concurrent edit marker')
  const results=await Promise.allSettled(Array.from({length:8},()=>publish(item)))
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1)
  expect(results.filter(result=>result.status==='rejected')).toHaveLength(7)
  const current=await service.getKnowledge(orgId,userId,item.id)
  expect(current.publishedRevision).toBe(2)
  expect(await db.knowledgeChunk.count({where:{organizationId:orgId,documentId:item.id}})).toBe(1)
  await expect(service.updateKnowledge(orgId,userId,item.id,{revision:1,title:'Stale update',category:'FAQ',contentText:'Must not overwrite live snapshot.'})).rejects.toThrow()
 })
 it('excludes revoked, unpublished and archived content immediately while retaining document history',async()=>{
  let item=await approve(await publish(await draft('Private after revoke','Zebrafish service costs 864 pesos.')))
  expect((await service.getReceptionistKnowledge(orgId,'zebrafish')).sources).toHaveLength(1)
  item=await service.transitionKnowledge(orgId,userId,item.id,{action:'revoke_receptionist',revision:item.revision})
  expect((await service.getReceptionistKnowledge(orgId,'zebrafish')).sources).toHaveLength(0)
  expect((await service.getAirishKnowledge(orgId,viewerId,'zebrafish')).sources).toHaveLength(1)
  item=await service.transitionKnowledge(orgId,userId,item.id,{action:'unpublish',revision:item.revision})
  expect((await service.getAirishKnowledge(orgId,viewerId,'zebrafish')).sources).toHaveLength(0)
  item=await approve(await publish(item))
  item=await service.transitionKnowledge(orgId,userId,item.id,{action:'archive',revision:item.revision})
  expect((await service.getReceptionistKnowledge(orgId,'zebrafish')).sources).toHaveLength(0)
  expect((await service.getKnowledge(orgId,userId,item.id)).archivedAt).not.toBeNull()
  expect(await db.knowledgeChunk.count({where:{documentId:item.id}})).toBe(0)
  await expect(service.updateKnowledge(orgId,userId,item.id,{revision:item.revision,title:'Archived',category:'FAQ',contentText:'Do not edit archives.'})).rejects.toThrow()
 })
 it('keeps FTS, category synonyms, and public approval inside the requested tenant',async()=>{
  const control=await approve(await publish(await draft('Secret control prices','Ultraviolet private repair costs 321 pesos.','PRICING',otherOrgId,otherUserId),otherOrgId,otherUserId),otherOrgId,otherUserId)
  expect((await service.getReceptionistKnowledge(otherOrgId,'ultraviolet')).sources.map(row=>row.id)).toEqual([control.id])
  expect((await service.getReceptionistKnowledge(orgId,'ultraviolet')).sources).toHaveLength(0)
  expect((await service.getAirishKnowledge(orgId,viewerId,'ultraviolet')).sources).toHaveLength(0)
  const context=await service.getAirishKnowledge(orgId,viewerId,'how much')
  expect(context.sources.length).toBeGreaterThan(0)
  expect(context.sources.every(source=>source.category==='PRICING')).toBe(true)
  expect(context.text.length).toBeLessThanOrEqual(8000)
  await expect(db.knowledgeChunk.create({data:{organizationId:orgId,documentId:control.id,revision:control.publishedRevision!,ordinal:99,content:'Cross-tenant injection',title:'Bad metadata',category:'GENERAL'}})).rejects.toThrow()
  expect((await service.getKnowledge(otherOrgId,otherUserId,control.id)).contentText).toBe('Ultraviolet private repair costs 321 pesos.')
 })
 it('rolls back snapshots, chunks and audit on a chunk persistence failure',async()=>{
  const item=await draft('Atomic publishing','Rollback service policy.')
  const before=await db.auditEntry.count({where:{entityId:item.id}})
  sql(`CREATE FUNCTION reject_knowledge_chunk() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic knowledge chunk failure'; END $$; CREATE TRIGGER reject_knowledge_chunk BEFORE INSERT ON "KnowledgeChunk" FOR EACH ROW EXECUTE FUNCTION reject_knowledge_chunk();`)
  try{await expect(publish(item)).rejects.toThrow('Synthetic knowledge chunk failure')}finally{sql('DROP TRIGGER reject_knowledge_chunk ON "KnowledgeChunk"; DROP FUNCTION reject_knowledge_chunk();')}
  const after=await service.getKnowledge(orgId,userId,item.id)
  expect(after.revision).toBe(item.revision)
  expect(after.publishedAt).toBeNull()
  expect(await db.knowledgeChunk.count({where:{documentId:item.id}})).toBe(0)
  expect(await db.auditEntry.count({where:{entityId:item.id}})).toBe(before)
 })
 it('preserves the last published snapshot if replacement chunks fail',async()=>{
  const original=await publish(await draft('Published atomic guide','Quasar repair policy remains available.','SERVICES'))
  const edited=await service.updateKnowledge(orgId,userId,original.id,{revision:original.revision,title:'Replacement guide',category:'SERVICES',contentText:'Nebula replacement must not become live.'})
  const beforeAudits=await db.auditEntry.count({where:{entityId:original.id}})
  sql(`CREATE FUNCTION reject_knowledge_replacement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic replacement failure'; END $$; CREATE TRIGGER reject_knowledge_replacement BEFORE INSERT ON "KnowledgeChunk" FOR EACH ROW EXECUTE FUNCTION reject_knowledge_replacement();`)
  try{await expect(publish(edited)).rejects.toThrow('Synthetic replacement failure')}finally{sql('DROP TRIGGER reject_knowledge_replacement ON "KnowledgeChunk"; DROP FUNCTION reject_knowledge_replacement();')}
  const saved=await service.getKnowledge(orgId,userId,original.id)
  expect(saved.publishedText).toBe('Quasar repair policy remains available.')
  expect(saved.revision).toBe(edited.revision)
  expect((await service.getAirishKnowledge(orgId,viewerId,'quasar')).sources).toHaveLength(1)
  expect((await service.getAirishKnowledge(orgId,viewerId,'nebula')).sources).toHaveLength(0)
  expect(await db.auditEntry.count({where:{entityId:original.id}})).toBe(beforeAudits)
 })
 it('enforces management permissions, reader access and current membership',async()=>{
  const item=await draft('Admin draft','Protected unpublished content.')
  await expect(service.getKnowledge(orgId,viewerId,item.id)).rejects.toThrow()
  await expect(service.createKnowledge(orgId,viewerId,{title:'Forbidden',category:'FAQ',contentText:'Text'})).rejects.toThrow()
  await expect(service.getAirishKnowledge(otherOrgId,viewerId,'pricing')).rejects.toThrow()
  await db.organizationMember.delete({where:{userId_organizationId:{userId:viewerId,organizationId:orgId}}})
  await expect(service.getAirishKnowledge(orgId,viewerId,'pricing')).rejects.toThrow()
 })
 it('serializes concurrent creates at the 50-document cap',async()=>{
  const count=await db.knowledgeDocument.count({where:{organizationId:otherOrgId,archivedAt:null}})
  await db.knowledgeDocument.createMany({data:Array.from({length:49-count},(_,index)=>({organizationId:otherOrgId,createdById:otherUserId,title:`Limit fixture ${index}`,category:'GENERAL',contentText:'Synthetic limit fixture.'}))})
  const results=await Promise.allSettled(Array.from({length:8},(_,index)=>draft(`Concurrent limit ${index}`,'One final document.','GENERAL',otherOrgId,otherUserId)))
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1)
  expect(await db.knowledgeDocument.count({where:{organizationId:otherOrgId,archivedAt:null}})).toBe(50)
 })
})
