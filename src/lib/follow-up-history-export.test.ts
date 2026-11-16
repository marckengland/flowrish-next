import {afterEach,expect,it,vi} from 'vitest'
import {buildHistoryCsv,collectHistoryCsv,HISTORY_EXPORT_BATCH_SIZE,MAX_HISTORY_EXPORT_BATCHES} from './follow-up-history-export'
const context={organizationId:'org',userId:'actor'},id='11111111-1111-4111-8111-111111111111',at='2026-11-05T02:00:00.000Z'
const entry=(n:number)=>({id:`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,kind:'approved' as const,actor:'You' as const,occurredAt:new Date(Date.parse(at)-n*1000).toISOString(),until:null,timeZone:null})
const rows=[entry(1),entry(2)],options=()=>({id,context,kind:'all' as const,range:null,displayTimeZone:'Asia/Manila',signal:new AbortController().signal,isCurrent:()=>true,onProgress:vi.fn()})
const data=(page=1,entries=rows,more=false)=>({id,kind:'all',range:null,page,hasMore:more,paging:{cursor:`export_${page}`,nextCursor:more?`export_${page+1}`:null},exportVersion:1,batchSize:200,entries,current:{state:'pending',until:null,timeZone:null,checkedAt:at}})
const ok=(value:unknown,scope=context)=>new Response(JSON.stringify({data:value,scope,capabilities:{canWrite:false}}))
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();vi.useRealTimers()})
it('creates quoted spreadsheet-safe CSV with UTC/local times and metadata, including zero-action exports',()=>{
 const sample={...entry(1),kind:'snoozed' as const,until:at,timeZone:'\t=HYPERLINK("bad", "bad")\r\nnext'},csv=buildHistoryCsv([sample],{kind:'all',range:null,displayTimeZone:'Asia/Manila'},at,at)
 expect(csv.startsWith('\uFEFF"Row type","Action ID"')).toBe(true);expect(csv).toContain('"Export details"');expect(csv).toContain('"Action"');expect(csv).toContain('"Snoozed follow-up"');expect(csv).toContain('"2026-11-05 09:59:59.000"');expect(csv).toContain('"Asia/Manila"');expect(csv).toContain('"\'\t=HYPERLINK(""bad"", ""bad"")\r\nnext"');expect(csv).not.toMatch(/draft|sourceText|organizationId|userId|inputHash|cursor/)
 const empty=buildHistoryCsv([],options(),at,at);expect(empty.split('\r\n').filter(Boolean)).toHaveLength(2);expect(empty).toContain('"All dates"');expect(empty.split('\r\n').slice(1).some(line=>line.startsWith('"Action",'))).toBe(false);expect(empty).toContain('"0"')
})
it('reads every export page independently and rechecks the exact first snapshot before returning a file',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(ok(data(1,[entry(1)],true))).mockResolvedValueOnce(ok(data(2,[entry(2)]))).mockResolvedValueOnce(ok(data(1,[entry(1)],true)));vi.stubGlobal('fetch',fetcher);const input=options(),result=await collectHistoryCsv(input)
 expect(result.count).toBe(2);expect(result.csv).toContain(entry(2).id);expect(result.checkedAt).toBe(at);expect(fetcher).toHaveBeenCalledTimes(3);expect(String(fetcher.mock.calls[0][0])).toBe(`/api/follow-ups/${id}/history/export?page=1`);expect(String(fetcher.mock.calls[1][0])).toContain('page=2&cursor=export_2');expect(String(fetcher.mock.calls[2][0])).toContain('page=1&cursor=export_1');expect(fetcher.mock.calls.every(([,init])=>init?.method==='GET'&&init.cache==='no-store')).toBe(true);expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({'x-flowrish-workspace':'org','x-flowrish-follow-up-scope':'["org","actor"]'});expect(input.onProgress).toHaveBeenLastCalledWith({actions:2,batches:2,checking:true})
})
it.each(['duplicate','range','id','version','position','order','loop'] as const)('rejects a %s receipt instead of returning a partial file',async kind=>{
 const second={...data(2,[entry(2)]),...(kind==='duplicate'?{entries:[entry(1)]}:kind==='range'?{range:{from:'2026-11-05',to:'2026-11-05',timeZone:'UTC',start:'2026-11-05T00:00:00.000Z',end:'2026-11-06T00:00:00.000Z'}}:kind==='id'?{id:'other'}:kind==='version'?{exportVersion:2}:kind==='position'?{paging:{cursor:'wrong',nextCursor:null}}:kind==='order'?{entries:[{...entry(2),occurredAt:'2026-11-06T02:00:00.000Z'}]}:{hasMore:true,paging:{cursor:'export_2',nextCursor:'export_2'}})}
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(ok(data(1,[entry(1)],true))).mockResolvedValueOnce(ok(second));vi.stubGlobal('fetch',fetcher);await expect(collectHistoryCsv(options())).rejects.toThrow();expect(fetcher).toHaveBeenCalledTimes(2)
})
it('continues empty malformed-only batches but rejects a changed final snapshot or lost access',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(ok(data(1,[],true))).mockResolvedValueOnce(ok(data(2,[entry(2)]))).mockResolvedValueOnce(ok(data(1,[entry(1)],true)));vi.stubGlobal('fetch',fetcher);await expect(collectHistoryCsv(options())).rejects.toThrow(/changed|verified/);expect(fetcher).toHaveBeenCalledTimes(3)
 fetcher.mockReset().mockResolvedValueOnce(ok(data())).mockResolvedValueOnce(new Response(JSON.stringify({error:{code:'FORBIDDEN',message:'Access revoked'}}),{status:403}));await expect(collectHistoryCsv(options())).rejects.toMatchObject({status:403});expect(fetcher).toHaveBeenCalledTimes(2)
})
it('stops cancelled, timed-out and over-limit exports without continuing automatically',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockImplementation(async url=>{const q=new URL(String(url),'https://example.invalid').searchParams,n=Number(q.get('page'));return ok(data(n,[],true))});vi.stubGlobal('fetch',fetcher);await expect(collectHistoryCsv(options())).rejects.toThrow(/narrow|Narrow/);expect(fetcher).toHaveBeenCalledTimes(MAX_HISTORY_EXPORT_BATCHES);expect(HISTORY_EXPORT_BATCH_SIZE).toBe(200)
 fetcher.mockReset();const aborted=new AbortController();aborted.abort();await expect(collectHistoryCsv({...options(),signal:aborted.signal})).rejects.toMatchObject({name:'AbortError'});expect(fetcher).not.toHaveBeenCalled()
 vi.useFakeTimers();fetcher.mockReturnValue(new Promise(()=>{}));const pending=collectHistoryCsv(options());const checked=expect(pending).rejects.toThrow(/timed out/);await vi.advanceTimersByTimeAsync(30001);await checked;expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
})
it('uses only the captured applied calendar and action filters for every request and CSV metadata',async()=>{
 const range={from:'2026-11-05',to:'2026-11-05',timeZone:'Asia/Manila',start:'2026-11-04T16:00:00.000Z',end:'2026-11-05T16:00:00.000Z'},page={...data(),kind:'approved',range},fetcher=vi.fn<typeof fetch>().mockImplementation(async()=>ok(page));vi.stubGlobal('fetch',fetcher);const result=await collectHistoryCsv({...options(),kind:'approved',range})
 expect(fetcher).toHaveBeenCalledTimes(2);for(const [url]of fetcher.mock.calls){const q=new URL(String(url),'https://example.invalid').searchParams;expect(Object.fromEntries(q)).toMatchObject({kind:'approved',from:'2026-11-05',to:'2026-11-05',timeZone:'Asia/Manila'})}expect(result.csv).toContain('"2026-11-04T16:00:00.000Z","2026-11-05T16:00:00.000Z"');expect(result.csv).not.toContain('"All dates"')
})
it('advances an empty malformed-only first batch and downloads a complete zero-action result accurately',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(ok(data(1,[],true))).mockResolvedValueOnce(ok(data(2,[entry(2)]))).mockResolvedValueOnce(ok(data(1,[],true)));vi.stubGlobal('fetch',fetcher);expect((await collectHistoryCsv(options())).count).toBe(1);expect(fetcher).toHaveBeenCalledTimes(3)
 fetcher.mockReset().mockImplementation(async()=>ok(data(1,[])));const empty=await collectHistoryCsv(options());expect(empty.count).toBe(0);expect(empty.csv.split('\r\n').filter(Boolean)).toHaveLength(2);expect(fetcher).toHaveBeenCalledTimes(2)
})
