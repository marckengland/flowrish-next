import {spawnSync} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {appendFileSync,copyFileSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname,join,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {formatInboxPerformanceSummary} from './inbox-performance-summary.mjs'
import {cleanEnvironment} from './rehearsal-safety.mjs'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
/**
 * Owns one local disposable database. No caller database, image or container is accepted.
 * @param {{run?: (file: string, args: string[], options: {env: NodeJS.ProcessEnv, cwd?: string, encoding?: BufferEncoding | null, timeout?: number, maxBuffer?: number, input?: string | Buffer}) => {status: number | null, stdout: string | Buffer, stderr: string | Buffer, error?: Error, signal?: string | null}, sleep?: (ms: number) => Promise<void>, log?: (message: string) => void, parentEnv?: NodeJS.ProcessEnv}} [options]
 */
export async function runInboxPerformance({run=spawnSync,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),log=console.log,parentEnv=process.env}={}){
 const env={...cleanEnvironment(parentEnv),NODE_ENV:'test'},nonce=randomUUID(),name='flowrish-inbox-performance-'+nonce
 const call=(file,args,extra={})=>run(file,args,{env,cwd:root,encoding:'utf8',timeout:120000,maxBuffer:32*1024*1024,...extra})
 const checked=(result,label)=>{if(result.status!==0||result.error||result.signal)throw new Error(label);return result.stdout}
 const parse=(raw)=>{try{return JSON.parse(raw)}catch{throw new Error('Invalid local Docker metadata.')}}
 const endpoint=parse(checked(call('docker',['context','inspect','--format','{{json .Endpoints.docker.Host}}']),'Cannot inspect local Docker context.').trim())
 if(typeof endpoint!=='string'||!endpoint.startsWith('unix:///'))throw new Error('A local Unix Docker endpoint is required.')
 const docker=(args,extra)=>call('docker',['--host',endpoint,...args],extra)
 const image=checked(docker(['image','inspect','postgres:17','--format','{{.Id}}']),'An already cached PostgreSQL 17 image is required; no image was pulled.').trim()
 if(!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('Invalid cached PostgreSQL image identity.')
 let container,temporary,configCreated=false
 const config=join(root,`.inbox-performance-${nonce}.config.mts`)
 const verify=()=>{
  const info=parse(checked(docker(['inspect','--format','{{json .}}',container??name]),'Cannot inspect disposable container.'))
  if(!/^[a-f0-9]{64}$/.test(info.Id)||container&&info.Id!==container||info.Name!=='/'+name||info.Image!==image||info.Config?.Labels?.['flowrish.inbox-performance']!==nonce)throw new Error('Disposable container ownership check failed.')
  const ports=info.NetworkSettings?.Ports,binding=ports?.['5432/tcp'],requested=info.HostConfig?.PortBindings
  if(info.Mounts?.length||info.HostConfig?.Binds?.length||!ports||Object.keys(ports).length!==1||binding?.length!==1||binding[0].HostIp!=='127.0.0.1'||!/^\d+$/.test(binding[0].HostPort)||Number(binding[0].HostPort)<1||Number(binding[0].HostPort)>65535||Object.keys(requested??{}).length!==1||requested['5432/tcp']?.length!==1||requested['5432/tcp'][0].HostIp!=='127.0.0.1')throw new Error('Disposable container isolation check failed.')
  container=info.Id
  return binding[0].HostPort
 }
 const exec=(args,extra)=>{verify();return docker(['exec','-i',container,...args],extra)}
 try{
  container=checked(docker(['run','--pull=never','--detach','--name',name,'--label','flowrish.inbox-performance='+nonce,'--publish','127.0.0.1::5432','--tmpfs','/var/lib/postgresql/data:rw,size=512m','--env','POSTGRES_PASSWORD=mock-only',image]),'Cannot create disposable database.').trim()
  if(!/^[a-f0-9]{64}$/.test(container)){container=undefined;throw new Error('Invalid disposable container identity.')}
  const port=verify();let ready=false
  for(let i=0;i<60;i++){if(exec(['pg_isready','-h','127.0.0.1','-U','postgres']).status===0){ready=true;break}await sleep(250)}
  if(!ready)throw new Error('Disposable PostgreSQL startup failed.')
  temporary=mkdtempSync(join(tmpdir(),'flowrish-inbox-performance-'))
  copyFileSync(join(root,'prisma/schema.prisma'),join(temporary,'schema.prisma'))
  const schemaConfig=join(temporary,'prisma.config.mjs'),dummy='postgresql://synthetic:synthetic@127.0.0.1:1/unused'
  writeFileSync(schemaConfig,`export default {schema:${JSON.stringify(join(temporary,'schema.prisma'))},engine:'classic',datasource:{url:process.env.DATABASE_URL,directUrl:process.env.DIRECT_URL}};`)
  const sql=checked(call(process.execPath,[join(root,'node_modules/prisma/build/index.js'),'migrate','diff','--from-empty','--to-schema-datamodel',join(temporary,'schema.prisma'),'--script','--config',schemaConfig],{cwd:temporary,env:{...env,DATABASE_URL:dummy,DIRECT_URL:dummy}}),'Offline copied-schema SQL generation failed.')
  checked(exec(['psql','--no-psqlrc','-U','postgres','-v','ON_ERROR_STOP=1'],{input:sql}),'Disposable schema setup failed.')
  checked(exec(['psql','--no-psqlrc','-U','postgres','-v','ON_ERROR_STOP=1'],{input:"ALTER ROLE postgres SET TIMEZONE TO 'Asia/Manila';"}),'Disposable timezone setup failed.')
  const output=join(root,'test-results/inbox-performance',nonce);mkdirSync(output,{recursive:true})
  const guard=join(output,'violations.log'),report=join(output,'report.json');writeFileSync(guard,'')
  writeFileSync(config,`import {defineConfig} from 'vitest/config';import path from 'node:path';export default defineConfig({test:{environment:'node',include:['scripts/inbox-performance.integration.test.ts'],testTimeout:120000},resolve:{alias:{'@':path.resolve('src'),'server-only':path.resolve('src/test-stubs/server-only.ts')}}});`,{flag:'wx'});configCreated=true
  const result=call(process.execPath,[join(root,'node_modules/vitest/vitest.mjs'),'run','--config',config],{timeout:300000,env:{...env,INBOX_PERF_DATABASE_URL:`postgresql://postgres:mock-only@127.0.0.1:${port}/postgres`,INBOX_PERF_REPORT:report,REHEARSAL_ALLOWED_PORTS:port,REHEARSAL_GUARD_LOG:guard,NODE_OPTIONS:'--import='+join(root,'scripts/rehearsal-network-guard.mjs')}})
  writeFileSync(join(output,'run.log'),String(result.stdout??'')+String(result.stderr??''))
  checked(result,'Synthetic inbox performance checks failed; see '+join(output,'run.log'))
  if(readFileSync(guard,'utf8').trim())throw new Error('Synthetic inbox network/environment guard was triggered.')
  const results=parse(readFileSync(report,'utf8'))
  if(results.report?.length!==14||![1000,10000].every(size=>results.report.filter(r=>r.size===size).length===7))throw new Error('Incomplete synthetic performance report.')
  const summary=formatInboxPerformanceSummary(results)
  if(parentEnv.GITHUB_ACTIONS==='true'){
   if(!parentEnv.GITHUB_STEP_SUMMARY)throw new Error('GitHub step summary path is required.')
   try{appendFileSync(parentEnv.GITHUB_STEP_SUMMARY,summary)}catch{throw new Error('Cannot write synthetic performance job summary.')}
  }
  for(const row of results.report)log(JSON.stringify({...row,plan:row.plan?'captured':undefined}))
  log('Performance report: '+report)
  return {report,guard}
 }finally{
  if(configCreated)rmSync(config)
  if(temporary)rmSync(temporary,{recursive:true,force:true})
  if(container){verify();checked(docker(['rm','--force',container]),'Cannot remove owned disposable container.')}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runInboxPerformance().catch(error=>{console.error(error instanceof Error?error.message:'Synthetic inbox performance run failed.');process.exitCode=1})
