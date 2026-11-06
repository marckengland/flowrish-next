import {expect,it,vi} from 'vitest'
import {runInboxPerformance} from '../../scripts/run-inbox-performance.mjs'
function fake(mode='remote'){
 let nonce='',name=''
 return vi.fn((file:string,args:string[],options:{env:NodeJS.ProcessEnv})=>{
  if(file!=='docker')return {status:1,stdout:'',stderr:'synthetic-private-detail'}
  if(args.includes('context'))return {status:0,stdout:JSON.stringify(mode==='remote'?'tcp://remote.invalid:2375':'unix:///tmp/local-docker.sock'),stderr:''}
  if(args.includes('image'))return {status:mode==='missing-image'?1:0,stdout:'sha256:'+'a'.repeat(64),stderr:'synthetic-private-detail'}
  if(args.includes('run')){name=args[args.indexOf('--name')+1];nonce=args[args.indexOf('--label')+1].split('=')[1];return {status:0,stdout:'b'.repeat(64),stderr:''}}
  if(args.includes('inspect'))return {status:0,stdout:JSON.stringify({Id:'b'.repeat(64),Name:'/'+name,Image:'sha256:'+'a'.repeat(64),Config:{Labels:{'flowrish.inbox-performance':mode==='wrong-owner'?'foreign':nonce}},Mounts:mode==='mounted'?[{Source:'/private'}]:[],HostConfig:{Binds:null,PortBindings:{'5432/tcp':[{HostIp:mode==='public-port'?'0.0.0.0':'127.0.0.1',HostPort:'54321'}]}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:mode==='public-port'?'0.0.0.0':'127.0.0.1',HostPort:'54321'}]}}}),stderr:''}
  if(args.includes('rm'))return {status:0,stdout:'',stderr:''}
  expect(options.env.DATABASE_URL).toBeUndefined();expect(options.env.DEEPSEEK_API_KEY).toBeUndefined()
  return {status:1,stdout:'',stderr:'synthetic-private-detail'}
 })
}
it('rejects a remote Docker daemon before starting or accessing any database',async()=>{const run=fake();await expect(runInboxPerformance({run,log:vi.fn()})).rejects.toThrow(/local Unix Docker/);expect(run.mock.calls.some(([,args])=>args.includes('run')||args.includes('exec'))).toBe(false)})
it('requires a cached Postgres image and never pulls a service',async()=>{const run=fake('missing-image');await expect(runInboxPerformance({run,log:vi.fn()})).rejects.toThrow(/cached PostgreSQL/);expect(run.mock.calls.some(([,args])=>args.includes('pull')||args.includes('run'))).toBe(false)})
it.each(['wrong-owner','mounted','public-port'])('refuses SQL and cleanup on invalid container isolation: %s',async mode=>{const run=fake(mode);await expect(runInboxPerformance({run,log:vi.fn()})).rejects.toThrow(/ownership|isolation/);expect(run.mock.calls.some(([,args])=>args.includes('exec')||args.includes('rm'))).toBe(false)})
it('strips datasource/provider credentials and cleans up only its verified owned container after startup failure',async()=>{const run=fake('startup');await expect(runInboxPerformance({run,sleep:async()=>{},log:vi.fn(),parentEnv:{NODE_ENV:'test',PATH:process.env.PATH,DATABASE_URL:'synthetic-forbidden-db',DIRECT_URL:'synthetic-forbidden-direct',DEEPSEEK_API_KEY:'synthetic-forbidden-provider',NODE_OPTIONS:'synthetic-forbidden-hook',DOCKER_HOST:'tcp://remote.invalid'}})).rejects.toThrow('Disposable PostgreSQL startup failed.');const create=run.mock.calls.find(([,args])=>args.includes('run'))!;expect(create[1]).toContain('--pull=never');expect(create[1]).not.toContain('--mount');expect(create[1]).not.toContain('--volume');expect(create[2].env).not.toHaveProperty('DATABASE_URL');expect(create[2].env).not.toHaveProperty('DIRECT_URL');expect(create[2].env).not.toHaveProperty('DEEPSEEK_API_KEY');expect(create[2].env).not.toHaveProperty('NODE_OPTIONS');expect(create[2].env).not.toHaveProperty('DOCKER_HOST');expect(run.mock.calls.filter(([,args])=>args.includes('rm'))).toHaveLength(1)})
