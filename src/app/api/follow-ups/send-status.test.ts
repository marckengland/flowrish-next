import {beforeEach,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),permission:vi.fn(),list:vi.fn()}))
vi.mock('@/server/auth/session',()=>({requireSession:m.session}))
vi.mock('@/server/auth/permissions',()=>({requirePermission:m.permission}))
vi.mock('@/server/services/follow-ups',()=>({listFollowUps:m.list}))
import {GET} from './route'
const headers={'x-flowrish-workspace':'org','x-flowrish-follow-up-scope':JSON.stringify(['org','actor']),'x-flowrish-send-status':'1','x-flowrish-follow-up-page':'1'}
beforeEach(()=>{vi.clearAllMocks();m.session.mockResolvedValue({organizationId:'org',dbUser:{id:'actor'}});m.list.mockResolvedValue({items:[],canWrite:true,sendStatus:true})})
it('opts in to private send metadata without changing legacy argument positions and prevents caching',async()=>{const response=await GET(new Request('https://example.invalid/api/follow-ups?needsChecking=1',{headers}));expect(response.status).toBe(200);expect(m.list).toHaveBeenCalledWith('org','actor','PENDING',[],{search:'',source:'ALL',dueOnly:false,needsChecking:true},{},false,false,true);expect((await response.json()).capabilities.sendStatus).toBe(true);expect(response.headers.get('cache-control')).toContain('no-store')})
it('rejects unsupported filtered reads and malformed headers before listing private data',async()=>{expect((await GET(new Request('https://example.invalid/api/follow-ups?needsChecking=1',{headers:{...headers,'x-flowrish-send-status':'0'}}))).status).toBe(400);const noHeader={...headers} as Record<string,string>;delete noHeader['x-flowrish-send-status'];expect((await GET(new Request('https://example.invalid/api/follow-ups?needsChecking=1',{headers:noHeader}))).status).toBe(400);expect(m.list).not.toHaveBeenCalled()})
it('does not advertise metadata unless the service verified current send access',async()=>{m.list.mockResolvedValue({items:[],canWrite:false});const response=await GET(new Request('https://example.invalid/api/follow-ups',{headers}));expect(response.status).toBe(200);expect((await response.json()).capabilities).not.toHaveProperty('sendStatus')})
