import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FollowUpInbox } from './follow-up-inbox'
vi.mock('./email-match-inbox',()=>({EmailMatchInbox:()=>null}))
vi.mock('@/components/email/email-compose',()=>({EmailCompose:()=><label>Bulk completion draft<input defaultValue="Keep reply"/></label>}))
const scope={organizationId:'org',userId:'actor'},at='2026-11-06T00:00:00.000Z',version='a'.repeat(64)
const source=(id:string,taskId='task-'+id)=>({id,taskId,status:'APPROVED',sourceType:'EMAIL',sourceText:'Synthetic completion source '+id,title:'Callback '+id,description:'Notes',draftSubject:'Subject',draftBody:'Reply',createdAt:at,taskProgress:{state:'OPEN',dueDate:'2099-01-01T00:00:00.000Z',completedAt:null,checkedAt:at},lead:{id:'lead-'+id,firstName:'Practice '+id,lastName:'Clinic',email:'lead@example.invalid'}})
afterEach(()=>{cleanup();vi.restoreAllMocks()})
async function setup(readonly=false,extra=false){
 const items=[source('a'),source('alias','task-a'),source('b'),...(extra?[source('c')]:[])]
 const s={calls:[] as Array<{path:string;method:string}>,posts:[] as Array<{id:string;input:{requestId:string;taskId:string;expectedVersion:string}}>,receipts:new Map<string,unknown>(),completed:new Set<string>(),lose:'',stale:'',unavailable:false,changed:false,hold:'',release:()=>{},held:false}
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  const path=String(url),method=init?.method??'GET';s.calls.push({path,method});const q=new URL(path,'https://example.invalid').searchParams
  const reply=(data:unknown,wrong=false,page?:unknown)=>new Response(JSON.stringify({data,scope:wrong?{...scope,userId:'other'}:scope,capabilities:{canWrite:!readonly,taskProgress:true,taskOrder:true},...(page?{page}:{})}))
  if(path === '/api/follow-ups/batches' && method === 'POST') return reply({registration: JSON.parse(String(init?.body)), createdAt: at})
  if(path.startsWith('/api/follow-ups?'))return reply(q.get('status')==='APPROVED'?items.map(row=>({...row,taskProgress:s.unavailable?{state:'UNAVAILABLE'}:{...row.taskProgress,dueDate:s.changed?'2098-01-01T00:00:00.000Z':row.taskProgress.dueDate,...(s.completed.has(row.taskId)?{state:'COMPLETED',completedAt:at}:{})}})):[],false,{nextCursor:null,accessVersion:version,...(q.has('taskOrder')?{orderVersion:version}:{})})
  const match=path.match(/^\/api\/follow-ups\/([^/]+)\/task-completion/)
  if(match){const id=decodeURIComponent(match[1]),taskId=items.find(row=>row.id===id)!.taskId
   if(method==='GET'&&q.has('requestId'))return reply(s.receipts.get(q.get('requestId')!)??{id,requestId:q.get('requestId'),state:'not-recorded',task:null})
   if(method==='GET')return reply({id,version,leadName:'Practice '+id+' Clinic',task:{id:taskId,title:'Reviewed task '+id,description:'Reviewed task notes',assigneeId:'team-member',assigneeName:'Practice Owner',dueDate:'2099-01-01T00:00:00.000Z'}})
   expect(method).toBe('POST');expect(init?.headers).toMatchObject({'x-flowrish-workspace':'org','x-flowrish-follow-up-scope':JSON.stringify(['org','actor'])});const input=JSON.parse(String(init?.body));expect(input).toMatchObject({taskId,expectedVersion:version});s.posts.push({id,input});s.completed.add(taskId);const receipt={id,requestId:input.requestId,state:'confirmed',task:{id:taskId,dueDate:'2099-01-01T00:00:00.000Z',completedAt:at,checkedAt:at}};s.receipts.set(input.requestId,receipt)
   if(s.hold===id){s.held=true;await new Promise<void>(r=>{s.release=r})}if(s.lose===id)throw new Error('Lost completion response');return reply(receipt,s.stale===id)
  }
  throw new Error('Unexpected request '+method+' '+path)
 })
 const ui=render(<FollowUpInbox canWrite={!readonly} emailMatchContext={scope}/>);await screen.findByText('No pending follow-ups');fireEvent.click(screen.getByRole('tab',{name:'Approved'}));await screen.findByText('Synthetic completion source a');if(!readonly)fireEvent.change(screen.getByRole('combobox',{name:'Bulk actions'}),{target:{value:'complete'}});return {s,ui}
}
const bulk=()=>screen.getByRole('region',{name:'Bulk task completion'})
async function review(){fireEvent.change(screen.getByRole('combobox',{name:'Bulk actions'}),{target:{value:'complete'}});fireEvent.click(within(bulk()).getByRole('button',{name:'Select up to 20 for completion'}));fireEvent.click(within(bulk()).getByRole('button',{name:'Review selected task completions'}));await within(bulk()).findByRole('group',{name:'Bulk completion review'});await waitFor(()=>expect(within(bulk()).getByRole('button',{name:'Confirm bulk completion'})).toBeEnabled())}
it('reviews unique linked tasks and exact assignees before explicitly completing, preserving original drafts and filters',async()=>{
 const {s}=await setup();fireEvent.change(screen.getByRole('combobox',{name:'Task progress'}),{target:{value:'OPEN'}});fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Apply filters'})).toBeEnabled());fireEvent.click(within(screen.getByRole('article',{name:'Follow-up for Practice a Clinic'})).getByRole('button',{name:'Review email draft'}));const draft=screen.getByLabelText('Bulk completion draft');fireEvent.change(draft,{target:{value:'Keep exact bulk draft'}})
 await review();expect(s.posts).toHaveLength(0);expect(within(bulk()).getAllByText('Assigned to: Practice Owner')).toHaveLength(2);expect(within(bulk()).queryByText('Reviewed task alias')).not.toBeInTheDocument()
 fireEvent.click(screen.getByRole('button',{name:/^Refresh$/}));expect(screen.getByRole('group',{name:'Bulk task completion navigation'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Stay with bulk completion'}))
 fireEvent.change(screen.getByRole('combobox',{name:'Task order'}),{target:{value:'DUE_ASC'}});fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Apply filters'})).toBeEnabled());expect(within(bulk()).getByRole('group',{name:'Bulk completion review'})).toBeInTheDocument()
 fireEvent.click(within(bulk()).getByRole('button',{name:'Confirm bulk completion'}));await within(bulk()).findByText('2 of 2 task completions confirmed or verified.');expect(s.posts.map(row=>row.id)).toEqual(['a','b']);expect(new Set(s.posts.map(row=>row.input.requestId)).size).toBe(2);expect(screen.getByLabelText('Bulk completion draft')).toBe(draft);expect(draft).toHaveValue('Keep exact bulk draft');expect(screen.getByRole('combobox',{name:'Task progress'})).toHaveValue('OPEN');expect(screen.getByRole('combobox',{name:'Task order'})).toHaveValue('DUE_ASC');expect(screen.getAllByRole('article')).toHaveLength(3)
})
it('stops after a lost receipt and verifies it with GET without completing remaining tasks',async()=>{
 const {s}=await setup();await review();s.lose='a';fireEvent.click(within(bulk()).getByRole('button',{name:'Confirm bulk completion'}));await within(bulk()).findByText(/Completion could not be confirmed\. Check results before trying again\./);expect(s.posts).toHaveLength(1);expect(within(bulk()).getByText(/Not attempted/)).toBeInTheDocument();fireEvent.focus(window);expect(s.posts).toHaveLength(1);await waitFor(()=>expect(within(bulk()).getByRole('button',{name:'Check completion results'})).toBeEnabled())
 fireEvent.click(within(bulk()).getByRole('button',{name:'Check completion results'}));await within(bulk()).findByText('1 of 2 task completions confirmed or verified.');expect(s.posts).toHaveLength(1);expect(s.calls.filter(row=>row.path.includes('requestId=')).map(row=>row.method)).toEqual(['GET']);expect(within(bulk()).queryByRole('button',{name:'Confirm bulk completion'})).not.toBeInTheDocument()
})
it('hides bulk controls from read-only users and makes no task preview or completion request',async()=>{const {s}=await setup(true);expect(screen.queryByRole('region',{name:'Bulk task completion'})).not.toBeInTheDocument();expect(screen.queryByRole('checkbox',{name:/Select task for completion/})).not.toBeInTheDocument();expect(s.calls.every(row=>row.method==='GET'&&!row.path.includes('/task-completion'))).toBe(true)})
it('invalidates changed reviews and hides inaccessible task details without submitting',async()=>{
 const {s}=await setup();await review();s.changed=true;fireEvent.focus(window);await within(bulk()).findByText('Selected tasks changed. Review again before completing.');expect(within(bulk()).getByRole('button',{name:'Confirm bulk completion'})).toBeDisabled();expect(s.posts).toHaveLength(0)
 s.unavailable=true;fireEvent.focus(window);await waitFor(()=>expect(within(bulk()).queryByText('Reviewed task a')).not.toBeInTheDocument());expect(s.posts).toHaveLength(0)
})
it('stops and clears private data on a stale-account confirmation before another POST',async()=>{
 const {s}=await setup();await review();s.stale='a';fireEvent.click(within(bulk()).getByRole('button',{name:'Confirm bulk completion'}));await screen.findByText('Access changed. Reload before continuing.');expect(s.posts).toHaveLength(1);expect(screen.queryByRole('article')).not.toBeInTheDocument();expect(screen.queryByText('Reviewed task a')).not.toBeInTheDocument()
})
it('drops an unmounted delayed confirmation without sending queued tasks',async()=>{const {s,ui}=await setup(false,true);await review();s.hold='a';fireEvent.click(within(bulk()).getByRole('button',{name:'Confirm bulk completion'}));await waitFor(()=>expect(s.held).toBe(true));ui.unmount();s.release();await waitFor(()=>expect(s.posts).toHaveLength(1));expect(s.completed.has('task-b')).toBe(false);expect(s.completed.has('task-c')).toBe(false)})
