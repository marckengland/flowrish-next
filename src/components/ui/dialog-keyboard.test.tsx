import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Dialog } from './dialog'

it('retains input focus through parent edits and restores the invoking button after Escape', () => {
  function Editor() {
    const [open, setOpen] = useState(false), [name, setName] = useState('')
    return <><button onClick={() => setOpen(true)}>Edit sample</button><Dialog open={open} onClose={() => setOpen(false)} title="Sample editor"><label>Name<input value={name} onChange={e => setName(e.target.value)} /></label></Dialog></>
  }
  render(<Editor />)
  const trigger = screen.getByRole('button', { name: 'Edit sample' })
  trigger.focus(); fireEvent.click(trigger)
  const input = screen.getByRole('textbox', { name: 'Name' })
  input.focus(); fireEvent.change(input, { target: { value: 'Sample name' } })
  expect(input).toHaveFocus()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(trigger).toHaveFocus()
})

it('closes only the top dialog on Escape, then restores each invoking control', () => {
  function Nested() {
    const [outer, setOuter] = useState(false), [inner, setInner] = useState(false)
    return <><button onClick={() => setOuter(true)}>Open outer</button><Dialog open={outer} onClose={() => setOuter(false)} title="Outer"><button onClick={() => setInner(true)}>Open inner</button></Dialog><Dialog open={inner} onClose={() => setInner(false)} title="Inner"><button>Inner action</button></Dialog></>
  }
  render(<Nested />)
  const trigger = screen.getByRole('button', { name: 'Open outer' })
  trigger.focus(); fireEvent.click(trigger)
  const innerTrigger = screen.getByRole('button', { name: 'Open inner' })
  innerTrigger.focus(); fireEvent.click(innerTrigger)
  const action = screen.getByRole('button', { name: 'Inner action' })
  action.focus(); fireEvent.keyDown(action, { key: 'Escape' })
  expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull()
  expect(screen.getByRole('dialog', { name: 'Outer' })).toBeInTheDocument()
  expect(innerTrigger).toHaveFocus()
  fireEvent.keyDown(innerTrigger, { key: 'Escape' })
  expect(trigger).toHaveFocus()
})
