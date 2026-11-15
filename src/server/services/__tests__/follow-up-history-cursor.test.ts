import {expect,it} from 'vitest'
import {encodeHistoryCursor,decodeHistoryCursor} from '../follow-up-history-cursor'
const scope={organizationId:'org',userId:'actor',id:'followup',kind:'all' as const},through={id:'ffffffff-ffff-4fff-8fff-ffffffffffff',createdAt:new Date('2026-11-05T02:00:00.000Z')},after={...through,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}
it('round trips a versioned stable history position including timestamp ties',()=>{
 const token=encodeHistoryCursor(scope,{page:2,through,after});expect(token.length).toBeLessThanOrEqual(2048);expect(decodeHistoryCursor(scope,token,2)).toEqual({page:2,through,after});expect(token).not.toContain('org');expect(decodeHistoryCursor(scope,encodeHistoryCursor(scope,{page:1,through:null,after:null}),1)).toEqual({page:1,through:null,after:null})
})
it('rejects cross-scope, cross-kind, cross-page and malformed or reversed positions',()=>{
 const token=encodeHistoryCursor(scope,{page:2,through,after})
 for(const change of [{organizationId:'other'},{userId:'other'},{id:'other'},{kind:'restored' as const}])expect(()=>decodeHistoryCursor({...scope,...change},token,2)).toThrow(/Refresh/)
 expect(()=>decodeHistoryCursor(scope,token,3)).toThrow(/Refresh/)
 for(const raw of ['invalid','a'.repeat(2049),'!!'])expect(()=>decodeHistoryCursor(scope,raw,2)).toThrow()
 const raw=JSON.parse(Buffer.from(token,'base64url').toString());for(const change of [{v:2},{page:1},{through:null},{after:null},{after:{...raw.after,createdAt:'2026-11-06T02:00:00.000Z'}}])expect(()=>decodeHistoryCursor(scope,Buffer.from(JSON.stringify({...raw,...change})).toString('base64url'),2)).toThrow()
})
