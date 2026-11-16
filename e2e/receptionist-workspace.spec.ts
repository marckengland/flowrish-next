import { expect, test, type BrowserContext, type Page, type Request as BrowserRequest } from '@playwright/test'
import { setupFixture } from '../src/components/settings/receptionist-setup-fixture.test-data'
import type { HandoffDraft } from '../src/lib/callback-handoff'

test.use({ storageState: { cookies: [], origins: [] }, serviceWorkers: 'block', timezoneId: 'Asia/Manila' })
const one='11111111-1111-4111-8111-111111111111',two='22222222-2222-4222-8222-222222222222',owner='33333333-3333-4333-8333-333333333333',stage='44444444-4444-4444-8444-444444444444'
const callbackIds:Record<string,string>={[one]:'55555555-5555-4555-8555-555555555555',[two]:'66666666-6666-4666-8666-666666666666'},leadIds:Record<string,string>={[one]:'77777777-7777-4777-8777-777777777777',[two]:'88888888-8888-4888-8888-888888888888'},taskId='99999999-9999-4999-8999-999999999999',at='2026-11-16T01:00:00.000Z'
type View='setup'|'handoff'
function gate(){let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve});return {pending,release}}
async function mock(context:BrowserContext,baseURL:string){
 const origin=new URL(baseURL).origin,a=setupFixture(),b=setupFixture();a.business.values.businessName='Studio saved business';b.business.values.businessName='Clinic saved business'
 const state={active:one,rows:{[one]:a,[two]:b} as Record<string,ReturnType<typeof setupFixture>>,writes:[] as {path:string;scope:string;body:unknown}[],denials:[] as {path:string;scope:string}[],unexpected:[] as string[],hold:null as ReturnType<typeof gate>|null,recovering:false,returned:false}
 await context.addCookies([{name:'mock_workspace',value:one,url:origin}])
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method(),scope=req.headers()['x-flowrish-workspace']
  const fail=async()=>{state.unexpected.push(`${method} ${path}`);await route.abort()}
  if(url.origin!==origin||/receptionist-widget/.test(path)){await fail();return}
  if(path==='/workspaces'&&req.isNavigationRequest()){state.recovering=true;await route.continue();return}
  if(path==='/api/workspaces'){
   if(method==='GET'){await route.fulfill({json:{data:{workspaces:[{id:one,name:'Practice Studio'},{id:two,name:'Practice Clinic'}]}}});return}
   if(method!=='POST'){await fail();return}
   const body=req.postDataJSON();expect([one,two]).toContain(body.organizationId);state.writes.push({path,scope,body});state.active=body.organizationId;await context.addCookies([{name:'mock_workspace',value:state.active,url:origin}]);await route.fulfill({json:{data:{organizationId:state.active}}});return
  }
  if(path.startsWith('/api/')){
   if(scope!==state.active){state.denials.push({path,scope});await route.fulfill({status:409,json:{error:{code:'WORKSPACE_CHANGED',message:'Reload the selected business.'}}});return}
   if(path==='/api/mock/workspace-leads'&&method==='GET'){await route.fulfill({json:{name:scope===one?'Studio prospect':'Clinic prospect'}});return}
   if(path==='/api/admin/receptionist/setup'&&method==='GET'){await route.fulfill({json:{data:state.rows[scope]}});return}
   if(path==='/api/admin/receptionist/setup/business'&&method==='PATCH'){
    const body=req.postDataJSON();expect(body.values.businessName).toBe('Studio confidential draft');state.writes.push({path,scope,body});state.rows[scope].business.values=body.values;const result=JSON.parse(JSON.stringify(state.rows[scope]));if(state.hold)await state.hold.pending;if(!req.failure())await route.fulfill({json:{data:result}});state.returned=true;return
   }
   const base=`/api/admin/website-receptionist/callbacks/${callbackIds[scope]}/handoff`,callback={id:callbackIds[scope],fullName:scope===one?'Studio Private Caller':'Clinic Caller',phone:'+12025550123',reason:scope===one?'Studio confidential callback':'Clinic callback',status:'pending',siteOrigin:'https://shop.example',consentedAt:at,createdAt:at,updatedAt:at}
   if(path===base&&method==='GET'){await route.fulfill({json:{data:{callback,receipt:null,leads:[{id:leadIds[scope],label:scope===one?'Studio lead':'Clinic lead'}],contacts:[],members:[{id:owner,label:'Callback Owner'}],stages:[{id:stage,label:'New'}],matchesTruncated:false,choicesTruncated:false}}});return}
   if(path===base+'/preview'&&method==='POST'){const draft=req.postDataJSON() as HandoffDraft;expect(draft.target).toEqual({mode:'lead',leadId:leadIds[scope]});await route.fulfill({json:{data:{version:'a'.repeat(64),draft,targetLabel:scope===one?'Studio lead':'Clinic lead',contactLabel:null,assigneeName:'Callback Owner',taskTitle:'Callback review',taskDescription:callback.reason}}});return}
   if(path===base&&method==='POST'){const body=req.postDataJSON();expect(body.confirmed).toBe(true);expect(body.draft.target).toEqual({mode:'lead',leadId:leadIds[scope]});state.writes.push({path,scope,body});const receipt={callbackId:callback.id,leadId:leadIds[scope],taskId,createdAt:at,leadAvailable:true,taskAvailable:true};if(state.hold)await state.hold.pending;if(!req.failure())await route.fulfill({json:{data:receipt}});state.returned=true;return}
   await fail();return
  }
  if(!['GET','HEAD'].includes(method)){await fail();return}await route.continue()
 })
 return state
}
function dialogs(page:Page){const pending:Promise<void>[]=[];page.on('dialog',dialog=>{pending.push((async()=>{expect(dialog.type()).toBe('beforeunload');await dialog.accept()})())});return ()=>Promise.all(pending)}
async function open(page:Page,view:View){
 await page.goto(`/workspace-receptionist?view=${view}`);await expect(page.getByRole('combobox',{name:'Business',exact:true})).toBeEnabled()
 if(view==='setup'){await page.getByRole('button',{name:'1. Business',exact:true}).click();await expect(page.getByRole('textbox',{name:'Business name',exact:true})).toHaveValue('Studio saved business');await page.getByRole('textbox',{name:'Business name',exact:true}).fill('Studio confidential draft')}
 else{await page.getByRole('button',{name:'Prepare CRM handoff',exact:true}).click();await page.getByRole('combobox',{name:'CRM destination',exact:true}).selectOption(leadIds[one]);await page.getByRole('combobox',{name:'Callback owner',exact:true}).selectOption(owner);await page.getByLabel('Callback deadline',{exact:true}).fill('2030-01-01T10:00');await page.getByRole('button',{name:'Preview callback task',exact:true}).click();await page.getByRole('checkbox',{name:/I approve creating this callback task/}).check();await expect(page.getByRole('button',{name:'Confirm CRM handoff',exact:true})).toBeEnabled()}
}
async function submit(page:Page,view:View){await page.getByRole('button',{name:view==='setup'?'Save business details':'Confirm CRM handoff',exact:true}).click()}
async function clean(page:Page){await expect(page.getByRole('textbox',{name:'Business name',exact:true})).toHaveCount(0);await expect(page.getByText('Studio Private Caller · +12025550123',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Confirm CRM handoff',exact:true})).toHaveCount(0);await expect(page.locator('script[src*="receptionist-widget"],iframe[src*="website-receptionist"]')).toHaveCount(0)}
// Recovery must complete before releasing the old reply: the guard deliberately replaces the document.
async function recoveredView(page:Page){
 await expect(page.getByRole('heading',{name:'Choose your business',exact:true})).toBeVisible();await clean(page)
 const current=await page.evaluate(()=>({text:document.body.innerText,values:Array.from(document.querySelectorAll('input')).map(input=>input.value),links:Array.from(document.querySelectorAll('a')).map(a=>a.getAttribute('href')),widgets:document.querySelectorAll('script[src*="receptionist-widget"],iframe[src*="website-receptionist"]').length}))
 expect(current.text).toContain('Choose your business');expect(current.text).not.toContain('Studio Private Caller');expect(current.text).not.toContain('Studio confidential callback');expect(current.text).not.toContain('This callback has already been handed to CRM.');expect(current.text).not.toContain('Confirm CRM handoff');expect(current.values).not.toContain('Studio confidential draft');expect(current.links).not.toContain(`/leads/${leadIds[one]}`);expect(current.links).not.toContain(`/tasks/${taskId}`);expect(current.widgets).toBe(0)
}
function writeFinished(page:Page,view:View){
 let resolve!:(request:BrowserRequest)=>void;const promise=new Promise<BrowserRequest>(done=>{resolve=done})
 const observe=(request:BrowserRequest)=>{const path=new URL(request.url()).pathname;if(view==='setup'?request.method()==='PATCH'&&path==='/api/admin/receptionist/setup/business':request.method()==='POST'&&path===`/api/admin/website-receptionist/callbacks/${callbackIds[one]}/handoff`){dispose();resolve(request)}}
 const dispose=()=>{page.off('requestfinished',observe);page.off('requestfailed',observe)}
 page.on('requestfinished',observe);page.on('requestfailed',observe);return {promise,dispose}
}
for(const view of ['setup','handoff'] as const){
 for(const mobile of [false,true])test(`receptionist workspace switches ${view} on ${mobile?'mobile':'desktop'} without carrying edits or approvals`,async({page,context,baseURL},info)=>{
  const s=await mock(context,baseURL!),handled=dialogs(page);await page.setViewportSize(mobile?{width:390,height:844}:{width:1365,height:900});await open(page,view);await page.getByRole('combobox',{name:'Business',exact:true}).selectOption(two);await expect(page.getByRole('heading',{name:'Practice Clinic',exact:true})).toBeVisible();await clean(page);expect(s.writes.map(w=>w.path)).toEqual(['/api/workspaces']);expect(s.rows[two].business.values.businessName).toBe('Clinic saved business')
  await page.goto(`/workspace-receptionist?view=${view}`);if(view==='setup'){await page.getByRole('button',{name:'1. Business',exact:true}).click();await expect(page.getByRole('textbox',{name:'Business name',exact:true})).toHaveValue('Clinic saved business')}
  else{await page.getByRole('button',{name:'Prepare CRM handoff',exact:true}).click();await expect(page.getByText('Clinic Caller · +12025550123',{exact:true})).toBeVisible();await expect(page.getByRole('combobox',{name:'CRM destination',exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'Confirm CRM handoff',exact:true})).toHaveCount(0)}
  expect(s.writes.map(w=>w.path)).toEqual(['/api/workspaces']);expect(s.denials).toEqual([]);expect(s.unexpected).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('switched-business.png'),fullPage:true,animations:'disabled'});await handled()
 })
 test(`receptionist workspace rejects stale-tab ${view} writes before applying data`,async({page,context,baseURL})=>{
  const s=await mock(context,baseURL!),handled=dialogs(page);await open(page,view);s.active=two;await context.addCookies([{name:'mock_workspace',value:two,url:baseURL!}]);await submit(page,view);await expect(page.getByRole('heading',{name:'Choose your business',exact:true})).toBeVisible();await clean(page);expect(s.writes).toEqual([]);expect(s.denials).toHaveLength(1);expect(s.denials[0].scope).toBe(one);expect(s.rows[two].business.values.businessName).toBe('Clinic saved business');expect(s.unexpected).toEqual([]);await handled()
 })
 test(`receptionist workspace discards a delayed ${view} result after another tab switches`,async({page,context,baseURL})=>{
  const s=await mock(context,baseURL!),handled=dialogs(page);await open(page,view);const hold=gate(),finished=writeFinished(page,view);s.hold=hold
  try{
   await submit(page,view);await expect.poll(()=>s.writes.length).toBe(1);expect(s.writes[0].scope).toBe(one)
   const other=await context.newPage();await other.goto('/dashboard');await expect(other.getByRole('combobox',{name:'Business',exact:true})).toBeEnabled();await other.getByRole('combobox',{name:'Business',exact:true}).selectOption(two);await expect(other.getByRole('heading',{name:'Practice Clinic',exact:true})).toBeVisible();await expect.poll(()=>s.recovering).toBe(true);await recoveredView(page)
   hold.release();await expect.poll(()=>s.returned).toBe(true);const request=await finished.promise
   if(request.failure())expect(request.failure()!.errorText).toBe('net::ERR_ABORTED')
   else{const response=await request.response();expect(response?.status()).toBe(200);expect(await response!.finished()).toBeNull()}
   // A completed response's promise continuations and React's next paint must run before checking absence.
   await page.bringToFront();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await recoveredView(page)
   expect(s.rows[two].business.values.businessName).toBe('Clinic saved business');expect(s.writes.map(w=>w.scope)).toEqual([one,one]);expect(s.writes[1].path).toBe('/api/workspaces');await clean(other);await expect(page.getByRole('heading',{name:'Choose your business',exact:true})).toBeVisible();await clean(page);expect(s.writes).toHaveLength(2);expect(s.denials).toEqual([]);expect(s.unexpected).toEqual([])
  }finally{hold.release();finished.dispose();await handled()}
 })
}
