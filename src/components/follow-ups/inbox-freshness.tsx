'use client'
import {Button} from '@/components/ui/button'

type Props={offline:boolean;checking:boolean;needsCheck:boolean;failed:boolean;checkedAt:number|null;disabled:boolean;onCheck:()=>void}
/** List freshness is separate from count freshness and mutation confirmations. */
export function InboxFreshness({offline,checking,needsCheck,failed,checkedAt,disabled,onCheck}:Props){
 const message=offline?'Offline. Your loaded follow-ups and local work are kept.':checking?'Checking inbox…':failed?'The inbox could not be checked. Your local work is kept.':needsCheck?'Connection changed. Check again to refresh the inbox.':checkedAt===null?'The inbox has not been checked yet.':'Inbox list checked.'
 return <section aria-label="Inbox freshness" className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3">
  <div className="min-w-0 space-y-1">
   <p role="status" className="text-sm">{message}</p>
   {checkedAt!==null&&<p className="text-xs text-muted-foreground">Last checked: <time dateTime={new Date(checkedAt).toISOString()}>{new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(checkedAt)}</time></p>}
   <p className="max-w-2xl text-xs text-muted-foreground">Checking keeps drafts and unconfirmed results open. It does not retry actions.</p>
  </div>
  <Button type="button" variant="outline" disabled={disabled||offline||checking} onClick={onCheck}>Check again</Button>
 </section>
}
