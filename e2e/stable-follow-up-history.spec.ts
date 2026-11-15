import {expect,test,type Page} from '@playwright/test'
import {revealFollowUpDetails} from './helpers/follow-up-details'
import {coreIds} from './rehearsal-app/core-fixtures'
test.use({storageState:{cookies:[],origins:[]},serviceWorkers:'block',timezoneId:'Asia/Manila'})
const context={organizationId:coreIds.organization,userId:coreIds.user},id='77777777-7777-4777-8777-777777777777',at='2026-11-05T02:00:00.000Z'
const item={id,sourceType:'EMAIL',sourceText:'Synthetic filter source',title:'Review synthetic reply',description:'Review availability',draftSubject:'Synthetic proposal',draftBody:'Unsent synthetic template',status:'PENDING',taskId:null,snoozeVersion:'a'.repeat(64),lead:{id:coreIds.lead,firstName:'Practice',lastName:'Clinic',email:'lead@example.invalid'},createdAt:at}
const reviewItem={...item,id:'88888888-8888-4888-8888-888888888888',lead:{...item.lead,firstName:'Review'},sourceText:'Separate synthetic review source',sendStatus:{state:'NONE',updatedAt:null}}
type Kind='approved'|'dismissed'|'snoozed'|'woke'|'restored'
const entry=(n:number,kind:Kind)=>({id:`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`,kind,actor:'You',occurredAt:new Date(Date.parse(at)-n*1000).toISOString(),until:kind==='snoozed'?'2026-11-06T01:00:00.000Z':null,timeZone:kind==='snoozed'?'Asia/Manila':null})
const events=[...Array.from({length:45},(_,i)=>entry(i+1,'approved')),...Array.from({length:25},(_,i)=>entry(i+101,'restored')),entry(151,'dismissed'),entry(152,'snoozed'),entry(153,'woke')]
type Entry=ReturnType<typeof entry>
type Position={kind:string;page:number;through:Entry|null;after:Entry|null}
const encode=(position:Position)=>Buffer.from(JSON.stringify(position)).toString('base64url')
const compare=(a:Entry,b:Entry)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||(a.id<b.id?-1:a.id>b.id?1:0)
const state=()=>({rows:[...events],reads:[] as {kind:string;page:number;cursor:string|null}[],unexpected:[] as string[],reviewRow:false,previews:0,fail:false,bad:false,stale:false,hold:null as Promise<void>|null})
async function mock(page:Page,baseURL:string,s:ReturnType<typeof state>){
 const origin=new URL(baseURL).origin
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method()
  const json=(data:unknown)=>route.fulfill({json:{data,scope:s.stale?{...context,userId:'other'}:context,capabilities:{canWrite:true,sendResults:true,sendStatus:true}}})
  if(url.origin!==origin||/receptionist-widget/.test(path)||!['GET','HEAD'].includes(method)){s.unexpected.push(`${method} ${path}`);await route.abort();return}
  if(path.startsWith('/api/follow-ups')){
   expect(req.headers()['x-flowrish-workspace']).toBe(context.organizationId);expect(req.headers()['x-flowrish-follow-up-scope']).toBe(JSON.stringify([context.organizationId,context.userId]))
   if(path===`/api/follow-ups/${id}/history`){
    expect(req.headers()['x-flowrish-history-page']).toBe('1')
    const n=Number(url.searchParams.get('page')),kind=url.searchParams.get('kind')??'all',raw=url.searchParams.get('cursor');s.reads.push({kind,page:n,cursor:raw})
    if(n===2&&kind==='all'&&s.hold)await s.hold
    if(s.fail){s.fail=false;await route.fulfill({status:503,json:{error:{code:'FOLLOW_UP_UNAVAILABLE',message:'Synthetic stable history failure'}}});return}
    const rows=s.rows.filter(row=>kind==='all'||row.kind===kind).sort((a,b)=>compare(b,a)),position:Position=raw?JSON.parse(Buffer.from(raw,'base64url').toString()):{kind,page:n,through:rows[0]??null,after:null}
    expect(position.kind).toBe(kind);expect(position.page).toBe(n)
    const matching=rows.filter(row=>position.through&&compare(row,position.through)<=0&&(!position.after||compare(row,position.after)<0)),entries=matching.slice(0,20),cursor=raw??encode(position),nextCursor=matching.length>20?encode({...position,page:n+1,after:entries[19]}):null,bad=s.bad;s.bad=false
    await json({id,kind,range:null,page:n,hasMore:nextCursor!==null,paging:{cursor:bad?'wrong_position':cursor,nextCursor},entries,current:{state:'pending',until:null,timeZone:null,checkedAt:new Date(Math.max(Date.parse(at),...s.rows.map(row=>Date.parse(row.occurredAt)))+1000).toISOString()}});return
   }
   if(path===`/api/follow-ups/${reviewItem.id}/approval`){s.previews++;await json({id:reviewItem.id,version:'a'.repeat(64),sourceType:'EMAIL',assigneeId:context.userId,title:reviewItem.title,description:reviewItem.description,existingTask:null,leadName:'Review Clinic'});return}
   if(path===`/api/follow-ups/${id}/send-result`){await json({id,state:'UNKNOWN',operationId:'99999999-9999-4999-8999-999999999999',updatedAt:at,result:null});return}
   if(path==='/api/follow-ups'){await json([{...item,sendStatus:{state:'UNKNOWN',updatedAt:at}},...(s.reviewRow?[reviewItem]:[])]);return}
  }
  if(path==='/api/email/matches'||path==='/api/follow-up-views'){await json([]);return}
  if(path.startsWith('/api/')){s.unexpected.push(`${method} ${path}`);await route.abort();return}
  await route.continue()
 })
}
const activity=(p:Page)=>p.getByRole('region',{name:'Follow-up activity',exact:true})
const select=(p:Page)=>activity(p).getByRole('combobox',{name:'Activity action',exact:true})
const times=(p:Page)=>activity(p).locator('li > time').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('datetime')))
async function open(p:Page){await revealFollowUpDetails(p);await p.getByRole('button',{name:'View activity',exact:true}).first().click();await expect(activity(p).getByRole('listitem')).toHaveCount(20)}
for(const width of [1280,390])test(`stable activity history navigates inserted actions without shifting pages at ${width}px`,async({page,baseURL},info)=>{
 const s=state();await page.setViewportSize({width,height:900});await mock(page,baseURL!,s);await page.goto('/follow-up-access');await open(page);const first=await times(page)
 await activity(page).getByRole('button',{name:'Older activity',exact:true}).click();await expect(activity(page).getByText('Activity · Page 2',{exact:true})).toBeVisible();const second=await times(page)
 const newer={...entry(9001,'approved'),occurredAt:'2026-11-05T02:01:00.000Z'};s.rows.unshift(newer)
 await activity(page).getByRole('button',{name:'Older activity',exact:true}).click();await expect(activity(page).getByText('Activity · Page 3',{exact:true})).toBeVisible();expect(await times(page)).toEqual(events.slice(40,60).map(row=>row.occurredAt));expect((await times(page)).some(value=>second.includes(value))).toBe(false)
 await activity(page).getByRole('button',{name:'Newer activity',exact:true}).click();await expect(activity(page).getByText('Activity · Page 2',{exact:true})).toBeVisible();expect(await times(page)).toEqual(second)
 await activity(page).getByRole('button',{name:'Newer activity',exact:true}).click();await expect(activity(page).getByText('Activity · Page 1',{exact:true})).toBeVisible();expect(await times(page)).toEqual(first);expect(s.reads.slice(1).every(read=>read.cursor!==null)).toBe(true)
 await activity(page).getByRole('button',{name:'Refresh activity',exact:true}).click();await expect.poll(async()=>(await times(page))[0]).toBe(newer.occurredAt);expect(s.reads.at(-1)?.cursor).toBeNull();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await activity(page).screenshot({path:info.outputPath('stable-history.png')});expect(s.unexpected).toEqual([])
})
test('stable activity history handles equal timestamps and resets cursors only for a new action filter',async({page,baseURL})=>{
 const s=state();s.rows=Array.from({length:45},(_,i)=>({...entry(i+1,'restored'),occurredAt:at}));await mock(page,baseURL!,s);await page.goto('/follow-up-access');await open(page);await select(page).selectOption('restored');await expect.poll(()=>s.reads.at(-1)?.kind).toBe('restored');await expect(activity(page).getByRole('listitem')).toHaveCount(20)
 await activity(page).getByRole('button',{name:'Older activity',exact:true}).click();await expect(activity(page).getByText('Activity · Page 2',{exact:true})).toBeVisible();const token=s.reads.at(-1)!.cursor!,position:Position=JSON.parse(Buffer.from(token,'base64url').toString());expect(position.after?.id).toBe(s.rows[25].id)
 s.rows.push({...entry(9001,'restored'),occurredAt:at});await activity(page).getByRole('button',{name:'Older activity',exact:true}).click();await expect(activity(page).getByRole('listitem')).toHaveCount(5);await expect(activity(page).getByRole('button',{name:'Older activity',exact:true})).toBeDisabled();await select(page).selectOption('approved');await expect(activity(page).getByText('No recorded actions on this page.',{exact:true})).toBeVisible();expect(s.reads.at(-1)).toEqual({kind:'approved',page:1,cursor:null});expect(s.unexpected).toEqual([])
})
test('stable activity history keeps mounted drafts, active reviews and blocked sends through paging and focus',async({page,baseURL})=>{
 const s=state();s.reviewRow=true;await mock(page,baseURL!,s);await page.goto('/follow-up-access');await page.getByRole('button',{name:'Review email draft',exact:true}).first().click();const subject=page.getByRole('textbox',{name:'Subject',exact:true});await subject.fill('Keep stable history draft');await subject.evaluate(el=>el.setAttribute('data-mount-proof','draft'));await expect(page.getByRole('region',{name:'Send recovery',exact:true}).getByRole('status')).toContainText('unknown');await page.getByRole('combobox',{name:'Bulk actions',exact:true}).selectOption('approve');const review=page.getByRole('region',{name:'Bulk task approval',exact:true});await review.getByRole('button',{name:'Select up to 20 for approval',exact:true}).click();await review.getByRole('button',{name:'Review task approvals',exact:true}).click();const title=review.getByRole('textbox',{name:'Approval task title for Review Clinic',exact:true});await title.fill('Keep stable review edit');await title.evaluate(el=>el.setAttribute('data-mount-proof','review'));await open(page);await activity(page).getByRole('button',{name:'Older activity',exact:true}).click();await expect(activity(page).getByText('Activity · Page 2',{exact:true})).toBeVisible();const before=s.reads.at(-1)!;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect.poll(()=>s.reads.length).toBe(3);await expect(activity(page).getByText('Activity · Page 2',{exact:true})).toBeVisible();expect(s.reads.at(-1)).toEqual(before);await expect(subject).toHaveValue('Keep stable history draft');await expect(subject).toHaveAttribute('data-mount-proof','draft');await expect(title).toHaveValue('Keep stable review edit');await expect(title).toHaveAttribute('data-mount-proof','review');await expect(review.getByRole('button',{name:'Confirm bulk approval',exact:true})).toBeEnabled();await expect(page.getByRole('button',{name:'Send email',exact:true})).toBeDisabled();expect(s.previews).toBe(1);expect(s.unexpected).toEqual([])
})
test('stable activity history retries the exact failed or unconfirmed page without resetting its boundary',async({page,baseURL})=>{
 const s=state();await mock(page,baseURL!,s);await page.goto('/follow-up-access');await open(page);s.fail=true;await activity(page).getByRole('button',{name:'Older activity',exact:true}).click();await expect(activity(page).getByRole('alert')).toHaveText('Synthetic stable history failure');const failed=s.reads.at(-1)!;s.bad=true;await activity(page).getByRole('button',{name:'Retry activity',exact:true}).click();await expect(activity(page).getByRole('alert')).toHaveText('Unexpected activity response. Refresh to try again.');expect(s.reads.at(-1)).toEqual(failed);await activity(page).getByRole('button',{name:'Retry activity',exact:true}).click();await expect(activity(page).getByText('Activity · Page 2',{exact:true})).toBeVisible();expect(s.reads.at(-1)).toEqual(failed);expect(s.reads).toHaveLength(4);expect(s.unexpected).toEqual([])
})
test('stable activity history ignores an obsolete continuation and clears rows only for active lost access',async({page,baseURL})=>{
 const s=state();let release!:()=>void;s.hold=new Promise(resolve=>{release=resolve});await mock(page,baseURL!,s);await page.goto('/follow-up-access');await open(page);await activity(page).getByRole('button',{name:'Older activity',exact:true}).click();await expect.poll(()=>s.reads.length).toBe(2);await select(page).selectOption('restored');await expect(activity(page).getByText('Activity · Page 1',{exact:true})).toBeVisible();release();s.hold=null;await expect(select(page)).toHaveValue('restored');await expect(activity(page).getByText('Restored to Pending',{exact:true})).toHaveCount(20);s.stale=true;await activity(page).getByRole('button',{name:'Refresh activity',exact:true}).click();await expect(page.getByText('Access changed. Reload before continuing.',{exact:true})).toBeVisible();await expect(activity(page)).toHaveCount(0);await expect(page.getByText(item.sourceText,{exact:true})).toHaveCount(0);expect(s.unexpected).toEqual([])
})
