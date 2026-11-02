// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AppError } from '@/lib/errors'
const mocks = vi.hoisted(() => ({ session:vi.fn(), permission:vi.fn(), list:vi.fn(), get:vi.fn(), create:vi.fn(), update:vi.fn(), transition:vi.fn(), extract:vi.fn() }))
vi.mock('@/server/auth/session',()=>({requireSession:mocks.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:mocks.permission}))
vi.mock('@/server/services/knowledge',()=>({listKnowledge:mocks.list,getKnowledge:mocks.get,createKnowledge:mocks.create,updateKnowledge:mocks.update,transitionKnowledge:mocks.transition}))
vi.mock('@/server/services/knowledge-extraction',()=>({extractKnowledgeFile:mocks.extract}))
import { GET,POST } from './route'
import { GET as DETAIL,PATCH } from './[id]/route'
import { POST as TRANSITION } from './[id]/publish/route'
import { POST as EXTRACT } from './extract/route'
const id='11111111-1111-4111-8111-111111111111'
const params={params:Promise.resolve({id})}
const request=(body:unknown)=>new NextRequest('https://example.com/api/knowledge',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue({organizationId:'org',dbUser:{id:'user'}});mocks.list.mockResolvedValue([]);mocks.get.mockResolvedValue({id});mocks.create.mockResolvedValue({id});mocks.update.mockResolvedValue({id});mocks.transition.mockResolvedValue({id});mocks.extract.mockResolvedValue({contentText:'Reviewed extraction',sourceName:'faq.txt',sourceMime:'text/plain',warnings:[]})})
describe('knowledge management API',()=>{
 it('scopes list/detail to the authenticated admin',async()=>{
  expect((await GET()).status).toBe(200)
  expect((await DETAIL(new NextRequest('https://example.com/api/knowledge/'+id),params)).status).toBe(200)
  expect(mocks.list).toHaveBeenCalledWith('org','user')
  expect(mocks.get).toHaveBeenCalledWith('org','user',id)
  expect(mocks.permission).toHaveBeenCalledWith({id:'user'},'admin:settings')
 })
 it('requires login and admin permission before reading or writing',async()=>{
  mocks.session.mockRejectedValue(new AppError('UNAUTHORIZED','Sign in',401))
  expect((await GET()).status).toBe(401)
  mocks.session.mockResolvedValue({organizationId:'org',dbUser:{id:'user'}})
  mocks.permission.mockImplementation(()=>{throw new AppError('FORBIDDEN','No access',403)})
  expect((await POST(request({}))).status).toBe(403)
  expect(mocks.create).not.toHaveBeenCalled()
 })
 it('passes draft edits and explicit snapshot approval without trusting client identity',async()=>{
  const draft={title:'FAQ',category:'FAQ',contentText:'Text',revision:2,organizationId:'other'}
  expect((await POST(request(draft))).status).toBe(201)
  expect((await PATCH(request(draft),params)).status).toBe(200)
  const approval={action:'approve_receptionist',revision:2,publishedRevision:1,acknowledged:true}
  expect((await TRANSITION(request(approval),params)).status).toBe(200)
  expect(mocks.transition).toHaveBeenCalledWith('org','user',id,approval)
 })
 it('rejects malformed document IDs before querying',async()=>{
  expect((await DETAIL(new NextRequest('https://example.com/api/knowledge/bad'),{params:Promise.resolve({id:'bad'})})).status).toBe(400)
  expect(mocks.get).not.toHaveBeenCalled()
 })
 it('extracts one bounded upload into reviewable text without publishing',async()=>{
  const form=new FormData();form.set('file',new File(['FAQ text'],'faq.txt',{type:'text/plain'}))
  const response=await EXTRACT(new NextRequest('https://example.com/api/knowledge/extract',{method:'POST',body:form}))
  const result=await response.json()
  expect(response.status,JSON.stringify(result)).toBe(200)
  expect(result.data.contentText).toBe('Reviewed extraction')
  expect(mocks.extract).toHaveBeenCalledWith({name:'faq.txt',type:'text/plain',bytes:expect.any(Uint8Array)})
  expect(mocks.create).not.toHaveBeenCalled()
  expect(mocks.transition).not.toHaveBeenCalled()
 })
 it('rejects oversized upload bodies before extraction',async()=>{
  const response=await EXTRACT(new NextRequest('https://example.com/api/knowledge/extract',{method:'POST',headers:{'Content-Length':String(3*1024*1024),'Content-Type':'multipart/form-data; boundary=test'},body:'oversized'}))
  expect(response.status).toBe(413)
  expect(mocks.extract).not.toHaveBeenCalled()
 })
})
