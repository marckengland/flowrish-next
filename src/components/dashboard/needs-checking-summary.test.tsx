import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {NeedsCheckingSummary} from './needs-checking-summary'
import {WORKSPACE_EVENT} from '@/lib/workspace-context'
const context={organizationId:'org',userId:'actor'},filters={search:'',source:'ALL',dueOnly:false,needsChecking:true}
const receipt=(counts={PENDING:2,APPROVED:3,DISMISSED:0,SNOOZED:1},scope=context,canWrite=true)=>new Response(JSON.stringify({scope,capabilities:{canWrite},data:{counts,overdueTasks:0,checkedAt:new Date().toISOString(),filters}}))
const region=()=>screen.getByRole('region',{name:'Needs checking summary'})
beforeEach(()=>{vi.spyOn(navigator,'onLine','get').mockReturnValue(true)})
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.useRealTimers()})
it('shows the aggregate and matching-tab links with one scoped read and a checked time',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(receipt());render(<NeedsCheckingSummary context={context} canWrite />)
 await within(region()).findByText('6 email sends need checking');expect(within(region()).getByRole('link',{name:'Pending (2)'})).toHaveAttribute('href','/follow-ups?needsChecking=1&status=PENDING');expect(within(region()).getByRole('link',{name:'Approved (3)'})).toHaveAttribute('href','/follow-ups?needsChecking=1&status=APPROVED');expect(within(region()).getByRole('link',{name:'Snoozed (1)'})).toHaveAttribute('href','/follow-ups?needsChecking=1&status=SNOOZED');expect(within(region()).queryByRole('link',{name:/Dismissed/})).not.toBeInTheDocument();expect(region().querySelector('time')).toHaveAttribute('dateTime');expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]).toMatchObject(['/api/follow-ups/counts?needsChecking=1',{method:'GET',cache:'no-store',headers:{'x-flowrish-workspace':'org','x-flowrish-follow-up-scope':'["org","actor"]','x-flowrish-send-status':'1'}}])
})
it('distinguishes confirmed zero from unavailable without any send request',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(receipt({PENDING:0,APPROVED:0,DISMISSED:0,SNOOZED:0}));render(<NeedsCheckingSummary context={context} canWrite />);await within(region()).findByText('No email sends need checking.');expect(within(region()).getByRole('link',{name:'Open Needs checking'})).toHaveAttribute('href','/follow-ups?needsChecking=1&status=PENDING');expect(fetcher.mock.calls.every(([,init])=>init?.method==='GET')).toBe(true)
})
it('shows a recoverable failure rather than zero and refreshes only on request',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockRejectedValueOnce(new Error('temporary')).mockImplementation(async()=>receipt());render(<NeedsCheckingSummary context={context} canWrite />);await within(region()).findByRole('alert');expect(within(region()).queryByText(/No email sends/)).not.toBeInTheDocument();expect(within(region()).queryByRole('link')).not.toBeInTheDocument();expect(fetcher).toHaveBeenCalledOnce();fireEvent.click(within(region()).getByRole('button',{name:'Refresh summary'}));await within(region()).findByText('6 email sends need checking');expect(fetcher).toHaveBeenCalledTimes(2)
})
it.each(['stale-user','read-only','wrong-filter','malformed'] as const)('hides unverified %s counts',async kind=>{
 const data=kind==='stale-user'?receipt(undefined,{...context,userId:'other'}):kind==='read-only'?receipt(undefined,context,false):kind==='wrong-filter'?new Response(JSON.stringify({scope:context,capabilities:{canWrite:true},data:{counts:{PENDING:8,APPROVED:0,DISMISSED:0,SNOOZED:0},overdueTasks:0,checkedAt:new Date().toISOString(),filters:{...filters,needsChecking:false}}})):new Response('bad json')
 vi.spyOn(globalThis,'fetch').mockResolvedValue(data);render(<NeedsCheckingSummary context={context} canWrite />);await waitFor(()=>expect(within(region()).queryByText('Checking summary…')).not.toBeInTheDocument());expect(within(region()).queryByRole('link')).not.toBeInTheDocument();expect(within(region()).queryByText(/email sends need checking/)).not.toBeInTheDocument()
})
it('does not read or render private counts for a read-only viewer',()=>{
 const fetcher=vi.spyOn(globalThis,'fetch');render(<NeedsCheckingSummary context={context} canWrite={false} />);expect(screen.queryByRole('region',{name:'Needs checking summary'})).not.toBeInTheDocument();expect(fetcher).not.toHaveBeenCalled()
})
it('clears old identity counts immediately and ignores a held old response',async()=>{
 let finish!:(r:Response)=>void;const fetcher=vi.spyOn(globalThis,'fetch').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve})).mockImplementation(async()=>receipt({PENDING:1,APPROVED:0,DISMISSED:0,SNOOZED:0},{...context,userId:'next'}));const view=render(<NeedsCheckingSummary context={context} canWrite />);view.rerender(<NeedsCheckingSummary context={{...context,userId:'next'}} canWrite />);await within(region()).findByText('1 email send needs checking');await act(async()=>finish(receipt()));expect(within(region()).queryByText('6 email sends need checking')).not.toBeInTheDocument();expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);act(()=>window.dispatchEvent(new Event(WORKSPACE_EVENT)));expect(within(region()).queryByRole('link')).not.toBeInTheDocument();expect(within(region()).queryByText('1 email send needs checking')).not.toBeInTheDocument()
})
it('does not request offline or replay on reconnect until explicit refresh',async()=>{
 let online=false;vi.spyOn(navigator,'onLine','get').mockImplementation(()=>online);const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>receipt());render(<NeedsCheckingSummary context={context} canWrite />);await within(region()).findByText(/Offline/);expect(fetcher).not.toHaveBeenCalled();online=true;act(()=>window.dispatchEvent(new Event('online')));expect(fetcher).not.toHaveBeenCalled();fireEvent.click(within(region()).getByRole('button',{name:'Refresh summary'}));await within(region()).findByText('6 email sends need checking');expect(fetcher).toHaveBeenCalledOnce()
})
it('marks the snapshot stale on focus without a fetch, and refresh keeps it read-only',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async()=>receipt());render(<NeedsCheckingSummary context={context} canWrite />);await within(region()).findByText('6 email sends need checking');act(()=>window.dispatchEvent(new Event('focus')));expect(within(region()).getByText('Summary needs refreshing.')).toBeInTheDocument();expect(within(region()).queryByRole('link')).not.toBeInTheDocument();expect(fetcher).toHaveBeenCalledOnce();fireEvent.click(within(region()).getByRole('button',{name:'Refresh summary'}));await within(region()).findByText('6 email sends need checking');expect(fetcher).toHaveBeenCalledTimes(2)
})
it('marks a minute-old snapshot stale without polling or exposing actionable counts',async()=>{
 vi.spyOn(globalThis,'fetch').mockImplementation(async()=>receipt());render(<NeedsCheckingSummary context={context} canWrite />);await within(region()).findByText('6 email sends need checking');vi.useFakeTimers();fireEvent.click(within(region()).getByRole('button',{name:'Refresh summary'}));await act(async()=>{await vi.advanceTimersByTimeAsync(1)});await act(async()=>{await vi.advanceTimersByTimeAsync(60001)});expect(within(region()).getByText('Summary needs refreshing.')).toBeInTheDocument();expect(within(region()).queryByRole('link')).not.toBeInTheDocument()
})
