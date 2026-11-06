import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FollowUpInbox } from './follow-up-inbox'
vi.mock('./email-match-inbox', () => ({ EmailMatchInbox: () => null }))
vi.mock('@/components/email/email-compose', () => ({ EmailCompose: () => <label>Unsent order subject<input defaultValue="Keep draft" /></label> }))
const scope={organizationId:'org',userId:'actor'}, now='2026-11-06T00:00:00.000Z', version='a'.repeat(64)
const rows=[0,1].map(n=>({id:`item-${n}`,sourceType:'EMAIL',sourceText:`Synthetic order source ${n}`,title:`Task ${n}`,description:'Notes',draftSubject:'Subject',draftBody:'Draft',status:'APPROVED',taskId:`task-${n}`,lead:{id:`lead-${n}`,firstName:`Practice ${n}`,lastName:'Clinic',email:'lead@example.invalid'},createdAt:now,taskProgress:{state:'OPEN',dueDate:n?'2020-01-01T00:00:00.000Z':'2099-01-01T00:00:00.000Z',completedAt:null,checkedAt:now}}))
afterEach(()=>{cleanup();vi.restoreAllMocks()})
async function setup(){
 const state={calls:[] as string[],fail:false,hold:null as null|Promise<void>,supported:true}
 vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  expect(init?.method??'GET').toBe('GET');const path=String(url);state.calls.push(path);const q=new URL(path,'https://example.invalid').searchParams
  const reply=(data:unknown,page?:unknown)=>new Response(JSON.stringify({data,scope,capabilities:{canWrite:true,taskProgress:true,...(state.supported?{taskOrder:true}:{})},...(page?{page}:{})}))
  if(path==='/api/follow-up-views')return reply([{id:'11111111-1111-4111-8111-111111111111',name:'Earliest work',settings:{status:'APPROVED',filters:{search:'',source:'ALL',dueOnly:false,taskOrder:'DUE_ASC'}},revision:1,updatedAt:now}])
  if(!path.startsWith('/api/follow-ups?'))throw new Error(`Unexpected request ${path}`)
  if(q.has('taskOrder')){if(state.hold)await state.hold;if(state.fail)return new Response(JSON.stringify({error:{code:'FOLLOW_UP_ORDER_CHANGED',message:'Deadlines changed. Refresh to try again.'}}),{status:409})}
  return reply(q.get('status')==='APPROVED'?rows:[],{nextCursor:null,accessVersion:version,...(q.has('taskOrder')?{orderVersion:version}:{})})
 })
 render(<FollowUpInbox canWrite={true} emailMatchContext={scope}/>);await screen.findByText('No pending follow-ups');fireEvent.click(screen.getByRole('tab',{name:'Approved'}));await screen.findByText('Synthetic order source 0');return state
}
async function draft(){fireEvent.click(within(screen.getByRole('article',{name:'Follow-up for Practice 0 Clinic'})).getByRole('button',{name:'Review email draft'}));const node=await screen.findByLabelText('Unsent order subject');fireEvent.change(node,{target:{value:'Keep original order draft'}});return node}
function choose(){fireEvent.change(screen.getByRole('combobox',{name:'Task order'}),{target:{value:'DUE_ASC'}});fireEvent.click(screen.getByRole('button',{name:'Apply filters'}))}
it('applies deadline order read-only while preserving the exact composer node, filters and unsent draft',async()=>{
 const state=await setup(),node=await draft();choose();await waitFor(()=>expect(state.calls.at(-1)).toContain('taskOrder=DUE_ASC'));await waitFor(()=>expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Follow-up for Practice 1 Clinic'))
 expect(screen.getByLabelText('Unsent order subject')).toBe(node);expect(node).toHaveValue('Keep original order draft');expect(screen.queryByRole('group',{name:'Open draft confirmation'})).not.toBeInTheDocument();expect(state.calls.at(-1)).toContain('retain=item-0')
 fireEvent.change(screen.getByRole('combobox',{name:'Task progress'}),{target:{value:'OPEN'}});expect(screen.getByRole('combobox',{name:'Task order'})).toHaveValue('DUE_ASC')
 fireEvent.click(screen.getByRole('tab',{name:'Pending'}));expect(screen.getByRole('group',{name:'Open draft confirmation'})).toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));expect(node).toHaveValue('Keep original order draft')
})
it('retains the applied list after sort failure and retries the requested order without discarding a draft',async()=>{
 const state=await setup(),node=await draft();state.fail=true;choose();await screen.findByText('Deadlines changed. Refresh to try again.');expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Follow-up for Practice 0 Clinic');expect(screen.getByLabelText('Unsent order subject')).toBe(node)
 state.fail=false;fireEvent.click(screen.getByRole('button',{name:'Retry loading'}));await waitFor(()=>expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Follow-up for Practice 1 Clinic'));expect(node).toHaveValue('Keep original order draft');expect(state.calls.filter(path=>path.includes('taskOrder=DUE_ASC'))).toHaveLength(2)
})
it('does not apply a held sort after a new editor opens, and keeps that editor on explicit retry',async()=>{
 const state=await setup();let release!:()=>void;state.hold=new Promise<void>(resolve=>{release=resolve});choose();await waitFor(()=>expect(state.calls.at(-1)).toContain('taskOrder=DUE_ASC'));const node=await draft();release();await screen.findByText('The list changed while loading. Retry to continue with your current drafts.');expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Follow-up for Practice 0 Clinic')
 state.hold=null;fireEvent.click(screen.getByRole('button',{name:'Retry loading'}));await waitFor(()=>expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Follow-up for Practice 1 Clinic'));expect(screen.getByLabelText('Unsent order subject')).toBe(node);expect(state.calls.at(-1)).toContain('retain=item-0')
})
it('applies a synced order-only saved view without a draft discard prompt',async()=>{
 const state=await setup(),node=await draft();const details=screen.getByText('Saved views').closest('details')!;details.open=true;fireEvent(details,new Event('toggle'));await screen.findByRole('option',{name:'Earliest work'});fireEvent.change(screen.getByLabelText('Saved follow-up view'),{target:{value:'11111111-1111-4111-8111-111111111111'}});fireEvent.click(screen.getByRole('button',{name:'Apply view'}));await waitFor(()=>expect(state.calls.at(-1)).toContain('taskOrder=DUE_ASC'));await waitFor(()=>expect(screen.getAllByRole('article')[0]).toHaveAccessibleName('Follow-up for Practice 1 Clinic'));expect(screen.getByLabelText('Unsent order subject')).toBe(node);expect(screen.queryByRole('group',{name:'Open draft confirmation'})).not.toBeInTheDocument()
})
