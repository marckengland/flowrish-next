'use client'

import {useEffect,useState} from 'react'

export function SendStatusFreshness({checkedAt}:{checkedAt?:number}) {
 const [,setNow]=useState(()=>Date.now())
 const now=Date.now()
 useEffect(()=>{
  if(checkedAt===undefined)return
  const update=()=>setNow(Date.now()),timer=window.setInterval(update,60000)
  window.addEventListener('focus',update)
  return()=>{clearInterval(timer);window.removeEventListener('focus',update)}
 },[checkedAt])
 if(checkedAt===undefined)return <p className="text-xs text-muted-foreground">Not checked in this inbox.</p>
 if(!Number.isFinite(checkedAt)||checkedAt<0||checkedAt>now)return <p className="text-xs text-muted-foreground">Check time unavailable. Recheck when ready.</p>
 return <div className="space-y-1 text-xs text-muted-foreground"><p>Last checked: <time dateTime={new Date(checkedAt).toISOString()}>{new Date(checkedAt).toLocaleString()}</time></p>{now-checkedAt>=300000&&<p>Older result · recheck when ready.</p>}</div>
}
