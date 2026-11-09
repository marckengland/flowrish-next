import {expect,test,type Page} from '@playwright/test'
import {coreIds} from './rehearsal-app/core-fixtures'
test.use({storageState:{cookies:[],origins:[]},serviceWorkers:'block',timezoneId:'Asia/Manila'})
const scope={organizationId:coreIds.organization,userId:coreIds.user},id='44444444-9999-4999-8999-999999999999'
const row={id,sourceType:'EMAIL',sourceText:'Synthetic freshness conversation',title:'Discuss callback',description:'Source notes',draftSubject:'Quote',draftBody:'Unsent synthetic reply',createdAt:'2026-11-09T01:00:00.000Z',status:'PENDING',taskId:null,lead:{id:coreIds.lead,firstName:'Practice',lastName:'Clinic',email:'lead@example.invalid'}}
const state=()=>({failure:false,stale:false,status:'PENDING',hold:false,reads:[] as string[],writes:[] as unknown[],unexpected:[] as string[],release:null as null|(()=>void)})
async function mock(page:Page,base:string,s:ReturnType<typeof state>){const origin=new URL(base).origin;await page.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method()
 if(url.origin!==origin||/receptionist-widget/.test(path)){s.unexpected.push(method+' '+path);await route.abort();return}
 const reply=(data:unknown,paged=false)=>route.fulfill({json:{data,scope:s.stale?{...scope,userId:'other'}:scope,capabilities:{canWrite:true},...(paged?{page:{nextCursor:null,accessVersion:'a'.repeat(64)}}:{})}})
 if(path==='/api/follow-ups'&&method==='GET'){
  s.reads.push(url.search)
  if(s.hold){s.hold=false;await new Promise<void>(resolve=>{s.release=resolve})}
  if(s.failure)await route.fulfill({status:503,json:{error:{code:'UNAVAILABLE',message:'Synthetic freshness read failure'}}});else await reply([{...row,status:s.status}],true)
  return
 }
 if(path==='/api/email/matches'&&method==='GET'){await reply([]);return}
 if(path==='/api/follow-ups/'+id&&method==='PATCH'){s.writes.push(req.postDataJSON());await route.abort();return}
 if(path.startsWith('/api/')||!['GET','HEAD'].includes(method)){s.unexpected.push(method+' '+path);await route.abort();return}await route.continue()
})}
const freshness=(p:Page)=>p.getByRole('region',{name:'Inbox freshness',exact:true}),card=(p:Page)=>p.getByRole('article',{name:'Follow-up for Practice Clinic',exact:true}),filters=(p:Page)=>p.getByRole('search',{name:'Follow-up filters',exact:true})
async function open(p:Page,s:ReturnType<typeof state>){await p.goto('/follow-up-access');await expect(card(p)).toBeVisible();await expect(freshness(p).getByRole('button',{name:'Check again',exact:true})).toBeEnabled();expect(s.unexpected).toEqual([])}
async function draft(p:Page){await card(p).getByRole('button',{name:'Review email draft',exact:true}).click();const field=card(p).getByRole('textbox',{name:'Subject',exact:true});await field.fill('Keep freshness draft');await field.evaluate(el=>el.setAttribute('data-freshness-draft','mounted'));return field}
for(const width of [1280,390])test('inbox freshness supports read-only keyboard checks and offline draft recovery at '+width+'px',async({page,baseURL},info)=>{
 const s=state();await page.setViewportSize({width,height:900});await mock(page,baseURL!,s);await open(page,s);const field=await draft(page)
 await filters(page).getByRole('button',{name:'Filters',exact:true}).click();const search=filters(page).getByRole('searchbox');await search.fill('Unapplied freshness filter');await filters(page).getByRole('button',{name:'Filters',exact:true}).click()
 await page.context().setOffline(true);await expect(freshness(page).getByRole('status')).toContainText('Offline');await expect(freshness(page).getByRole('button',{name:'Check again',exact:true})).toBeDisabled();const before=s.reads.length
 await page.context().setOffline(false);await expect(freshness(page).getByRole('status')).toContainText('Check again');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect(s.reads).toHaveLength(before)
 const check=freshness(page).getByRole('button',{name:'Check again',exact:true});await check.focus();await page.keyboard.press('Enter');await expect.poll(()=>s.reads.length).toBe(before+1);await expect(check).toBeEnabled();await expect(freshness(page).getByRole('status')).toHaveText('Inbox list checked.');await expect(freshness(page).locator('time')).toHaveCount(1)
 await expect(field).toHaveValue('Keep freshness draft');await expect(field).toHaveAttribute('data-freshness-draft','mounted');await filters(page).getByRole('button',{name:'Filters',exact:true}).click();await expect(search).toHaveValue('Unapplied freshness filter');expect(s.reads.at(-1)).toContain('retain='+id);expect(s.reads.at(-1)).not.toContain('search=');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('inbox-freshness.png'),fullPage:true});expect(s.writes).toEqual([]);expect(s.unexpected).toEqual([])
})
test('inbox freshness keeps checked time, exact draft and uncertain dismissal through failed and successful reads',async({page,baseURL})=>{
 const s=state();await mock(page,baseURL!,s);await open(page,s);const field=await draft(page),stamp=await freshness(page).locator('time').getAttribute('datetime')
 await card(page).getByRole('button',{name:'Dismiss',exact:true}).click();const failure=card(page).getByRole('group',{name:'Follow-up error',exact:true});await expect(failure.getByText(/This result cannot be confirmed/)).toBeVisible();s.failure=true
 await freshness(page).getByRole('button',{name:'Check again',exact:true}).click();await expect(freshness(page).getByRole('status')).toContainText('could not be checked');await expect(freshness(page).locator('time')).toHaveAttribute('datetime',stamp!);const before=s.reads.length;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));expect(s.reads).toHaveLength(before);s.failure=false;s.status='DISMISSED'
 await freshness(page).getByRole('button',{name:'Check again',exact:true}).click();await expect.poll(()=>s.reads.length).toBe(before+1);await expect(freshness(page).getByRole('status')).toHaveText('Inbox list checked.');await expect(failure.getByText(/This result cannot be confirmed/)).toBeVisible();await expect(field).toHaveValue('Keep freshness draft');await expect(field).toHaveAttribute('data-freshness-draft','mounted');await expect(field).toBeDisabled();await expect(card(page).getByRole('button',{name:'Send email',exact:true})).toBeDisabled();expect(s.writes).toEqual([{action:'dismiss'}]);expect(s.unexpected).toEqual([])
})
test('inbox freshness aborts a pre-disconnect read and ignores its delayed response',async({page,baseURL})=>{
 const s=state();await mock(page,baseURL!,s);await open(page,s);const field=await draft(page),stamp=await freshness(page).locator('time').getAttribute('datetime');s.hold=true
 await freshness(page).getByRole('button',{name:'Check again',exact:true}).click();await expect.poll(()=>Boolean(s.release)).toBe(true);await page.context().setOffline(true);await expect(freshness(page).getByRole('status')).toContainText('Offline');await page.context().setOffline(false);s.release!();await expect(freshness(page).getByRole('status')).toContainText('Check again');await expect(freshness(page).locator('time')).toHaveAttribute('datetime',stamp!);expect(s.reads).toHaveLength(2)
 await freshness(page).getByRole('button',{name:'Check again',exact:true}).click();await expect(freshness(page).getByRole('status')).toHaveText('Inbox list checked.');await expect.poll(()=>s.reads.length).toBe(3);await expect(field).toHaveValue('Keep freshness draft');await expect(field).toHaveAttribute('data-freshness-draft','mounted');expect(s.writes).toEqual([]);expect(s.unexpected).toEqual([])
})
test('inbox freshness recovers an initially offline list only after an explicit check',async({page,baseURL})=>{
 const s=state();await mock(page,baseURL!,s);await page.addInitScript(()=>Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>false}));await page.goto('/follow-up-access');await expect(freshness(page).getByRole('status')).toContainText('Offline');await expect(freshness(page).locator('time')).toHaveCount(0);expect(s.reads).toEqual([]);await expect(page.getByText('No pending follow-ups',{exact:true})).toHaveCount(0);await expect(page.getByText('Inbox not checked. Connect and choose Check again.',{exact:true})).toBeVisible()
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,get:()=>true});window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'))});await expect(freshness(page).getByRole('button',{name:'Check again',exact:true})).toBeEnabled();expect(s.reads).toEqual([]);await freshness(page).getByRole('button',{name:'Check again',exact:true}).click();await expect(card(page)).toBeVisible();await expect(freshness(page).getByRole('status')).toHaveText('Inbox list checked.');expect(s.reads).toHaveLength(1);expect(s.writes).toEqual([]);expect(s.unexpected).toEqual([])
})
test('inbox freshness clears private drafts and checked metadata when the recovery receipt changes account',async({page,baseURL})=>{
 const s=state();await mock(page,baseURL!,s);await open(page,s);await draft(page);s.stale=true;await freshness(page).getByRole('button',{name:'Check again',exact:true}).click();await expect(page.getByText('Access changed. Reload before continuing.',{exact:true})).toBeVisible();await expect(freshness(page)).toHaveCount(0);await expect(card(page)).toHaveCount(0);await expect(page.getByRole('textbox',{name:'Subject',exact:true})).toHaveCount(0);expect(s.reads).toHaveLength(2);expect(s.writes).toEqual([]);expect(s.unexpected).toEqual([])
})
