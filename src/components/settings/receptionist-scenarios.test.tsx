import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialCallState } from '@/lib/receptionist'
import { ReceptionistScenarios } from './receptionist-scenarios'
import { ReceptionistPreview } from './receptionist-preview'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('reusable receptionist scenarios', () => {
  it('loads fictional drafts and explains expected behavior without grading the reply', () => {
    const select = vi.fn()
    render(<ReceptionistScenarios disabled={false} awaitingConfirmation={false} onSelect={select} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pricing and services' }))
    expect(select).toHaveBeenCalledWith('What services do you offer, and what do they cost?')
    expect(screen.getByText(/Use only approved pricing and services/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Correct callback details' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Confirm callback' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Unknown answer' }))
    expect(select).toHaveBeenLastCalledWith(expect.stringContaining('not listed in your approved information'))
    fireEvent.click(screen.getByRole('button', { name: 'Request a callback' }))
    expect(select).toHaveBeenLastCalledWith(expect.stringContaining('Jamie Example'))
    expect(screen.getByText(/does not send/i)).toBeInTheDocument()
  })

  it('gates correction and confirmation on callback readback and disables all presets when busy', () => {
    const select = vi.fn()
    const { rerender } = render(<ReceptionistScenarios disabled={false} awaitingConfirmation onSelect={select} />)
    fireEvent.click(screen.getByRole('button', { name: 'Correct callback details' }))
    expect(select).toHaveBeenLastCalledWith(expect.stringContaining('Jordan Example'))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm callback' }))
    expect(select).toHaveBeenLastCalledWith('yes')
    rerender(<ReceptionistScenarios disabled awaitingConfirmation onSelect={select} />)
    for (const button of screen.getAllByRole('button')) expect(button).toBeDisabled()
  })

  it('changes only the editable caller draft until explicitly sent and locks presets during the request', async () => {
    const result = { state: initialCallState(''), settingsVersion: 'version', reply: 'Hello, how can we help?', finished: false, callback: null, sources: [] }
    let finish!: (value: unknown) => void
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: result }) }).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vi.stubGlobal('fetch', fetch)
    render(<ReceptionistPreview hasSavedSettings hasUnsavedChanges={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start browser preview' }))
    await screen.findByRole('textbox', { name: 'Caller message' })
    fireEvent.click(screen.getByRole('button', { name: 'Pricing and services' }))
    expect(screen.getByRole('textbox', { name: 'Caller message' })).toHaveValue('What services do you offer, and what do they cost?')
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Send caller message' }))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[1][1].body).speech).toBe('What services do you offer, and what do they cost?')
    expect(screen.getByRole('button', { name: 'Pricing and services' })).toBeDisabled()
    finish({ ok: true, json: async () => ({ data: result }) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pricing and services' })).toBeEnabled())
  })
})
