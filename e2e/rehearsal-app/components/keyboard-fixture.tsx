'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Dialog } from '@/components/ui/dialog'
import { Header } from '@/components/layout/header'
import { Sidebar } from '@/components/layout/sidebar'
import { WorkspaceBoundary } from '@/components/layout/workspace-boundary'

const user = { name: 'Practice Owner', email: 'owner@example.test' }
export function KeyboardFixture() {
  const [open, setOpen] = useState(false), [inner, setInner] = useState(false), [name, setName] = useState('')
  const [rich, setRich] = useState(false)
  return <WorkspaceBoundary organizationId="11111111-1111-4111-8111-111111111111">
    <div className="flex min-h-screen">
      <Sidebar user={user} organizationName="Practice Studio" workspaceId="11111111-1111-4111-8111-111111111111" permissions={['leads:read', 'leads:write']} />
      <div className="min-w-0 flex-1">
        <Header user={user} organizationName="Practice Studio" />
        <section className="space-y-5 p-5">
          <h1>Keyboard practice</h1>
          <Link href="/leads/new">New lead form</Link>
          <button className="block rounded border px-3 py-2" onClick={() => setOpen(true)}>Open editor</button>
          <button onClick={() => setRich(true)}>Open rich note</button>
        </section>
      </div>
    </div>
    <Dialog open={open} onClose={() => setOpen(false)} title="Practice editor" showCloseButton={false}>
      <button hidden>Hidden action</button>
      <label htmlFor="keyboard-name">Practice name</label>
      <input id="keyboard-name" className="border" value={name} onChange={e => setName(e.target.value)} />
      <button tabIndex={-1}>Programmatic action</button>
      <button onClick={() => setInner(true)}>Open confirmation</button>
      <button onClick={() => setOpen(false)}>Cancel editor</button>
    </Dialog>
    <Dialog open={inner} onClose={() => setInner(false)} title="Practice confirmation" showCloseButton={false}>
      <button>Review sample</button><button onClick={() => setInner(false)}>Cancel confirmation</button>
    </Dialog>
    <Dialog open={rich} onClose={() => setRich(false)} title="Rich note editor" showCloseButton={false}>
      <div role="textbox" aria-label="Rich note" aria-multiline="true" contentEditable suppressContentEditableWarning className="border">Practice note</div>
      <button onClick={() => setRich(false)}>Close rich note</button>
    </Dialog>
  </WorkspaceBoundary>
}
