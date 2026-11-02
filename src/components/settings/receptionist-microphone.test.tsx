import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { initialCallState } from '@/lib/receptionist'
import { ReceptionistPreview } from './receptionist-preview'

class Recognition {
 static latest: Recognition
 onstart: (() => void) | null = null
 onend: (() => void) | null = null
 onerror: ((event: { error: string }) => void) | null = null
 onresult: ((event: { results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null = null
 start = vi.fn(() => this.onstart?.())
 stop = vi.fn()
 abort = vi.fn()
 constructor() { Recognition.latest = this }
 result(text: string, isFinal = true) { this.onresult?.({ results: [{ isFinal, 0: { transcript: text } }] }) }
}
const reply = { state: initialCallState(''), settingsVersion: 'sample-version', reply: 'Hello from Sample Cycles.', finished: false, callback: null, sources: [] }
let fetch: ReturnType<typeof vi.fn>
beforeEach(() => {
 fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: reply }) })
 vi.stubGlobal('fetch', fetch)
 vi.stubGlobal('SpeechRecognition', Recognition)
 vi.stubGlobal('webkitSpeechRecognition', undefined)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
async function begin() {
 const view = render(<ReceptionistPreview hasSavedSettings hasUnsavedChanges={false} />)
 fireEvent.click(screen.getByRole('button', { name: 'Start browser preview' }))
 await screen.findByRole('textbox', { name: 'Caller message' })
 const supportsRecognition = typeof Reflect.get(window, 'SpeechRecognition') === 'function' || typeof Reflect.get(window, 'webkitSpeechRecognition') === 'function'
 if (supportsRecognition) await waitFor(() => expect(microphone()).toBeEnabled())
 return view
}
function microphone() { return screen.getByRole('button', { name: 'Use microphone' }) }
function input() { return screen.getByRole('textbox', { name: 'Caller message' }) }

it('keeps typing usable when speech recognition is unsupported', async () => {
 vi.stubGlobal('SpeechRecognition', undefined)
 await begin()
 expect(microphone()).toBeDisabled()
 expect(screen.getByText(/microphone input is unavailable/i)).toBeInTheDocument()
 fireEvent.change(input(), { target: { value: 'Typed question' } })
 expect(screen.getByRole('button', { name: 'Send caller message' })).toBeEnabled()
})
it('dictates final text once into the editable message without sending it', async () => {
 vi.stubGlobal('SpeechRecognition', undefined)
 vi.stubGlobal('webkitSpeechRecognition', Recognition)
 await begin()
 fireEvent.change(input(), { target: { value: 'Hello.' } })
 fireEvent.click(microphone())
 act(() => Recognition.latest.result('what is your price', false))
 expect(input()).toHaveValue('Hello.')
 expect(screen.getByText(/what is your price/)).toBeInTheDocument()
 act(() => { Recognition.latest.result('What is your price?'); Recognition.latest.result('What is your price?'); Recognition.latest.onend?.() })
 expect(input()).toHaveValue('Hello. What is your price?')
 expect(input()).toBeEnabled()
 expect(fetch).toHaveBeenCalledTimes(1)
 fireEvent.change(input(), { target: { value: 'What is a tune-up price?' } })
 fireEvent.click(screen.getByRole('button', { name: 'Send caller message' }))
 await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
 expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ speech: 'What is a tune-up price?', settingsVersion: 'sample-version' })
})
it('stops read-aloud and blocks sending until recognition finishes', async () => {
 const cancel = vi.fn()
 vi.stubGlobal('speechSynthesis', { cancel, speak: vi.fn() })
 vi.stubGlobal('SpeechSynthesisUtterance', class {})
 await begin()
 fireEvent.change(input(), { target: { value: 'Existing text' } })
 fireEvent.click(microphone())
 expect(cancel).toHaveBeenCalled()
 expect(input()).toBeDisabled()
 expect(screen.getByRole('checkbox', { name: 'Read replies aloud' })).toBeDisabled()
 expect(screen.getByRole('button', { name: 'Send caller message' })).toBeDisabled()
 fireEvent.click(screen.getByRole('button', { name: 'Stop microphone' }))
 expect(screen.getByText(/finishing transcription/i)).toBeInTheDocument()
 expect(fetch).toHaveBeenCalledTimes(1)
 act(() => { Recognition.latest.result('More text'); Recognition.latest.onend?.() })
 expect(input()).toHaveValue('Existing text More text')
 expect(screen.getByRole('button', { name: 'Send caller message' })).toBeEnabled()
})
it.each([
 ['not-allowed', /microphone access was blocked/i],
 ['audio-capture', /no microphone is available/i],
 ['network', /speech recognition could not connect/i],
 ['no-speech', /no speech was recognized/i],
 ['service-not-allowed', /speech recognition is unavailable/i],
 ['language-not-supported', /language is unavailable/i],
])('recovers from %s without losing text or leaking provider details', async (error, message) => {
 await begin()
 fireEvent.change(input(), { target: { value: 'Keep this' } })
 fireEvent.click(microphone())
 act(() => Recognition.latest.onerror?.({ error }))
 expect(screen.getByRole('alert')).toHaveTextContent(message)
 expect(input()).toHaveValue('Keep this')
 expect(input()).toBeEnabled()
 expect(microphone()).toBeEnabled()
 expect(fetch).toHaveBeenCalledTimes(1)
})
it('cancels listening and ignores late results from an old session', async () => {
 await begin()
 fireEvent.click(microphone())
 const old = Recognition.latest
 const lateResult = old.onresult
 fireEvent.click(screen.getByRole('button', { name: 'Cancel microphone' }))
 expect(old.abort).toHaveBeenCalled()
 fireEvent.click(microphone())
 act(() => { lateResult?.({ results: [{ isFinal: true, 0: { transcript: 'Stale text' } }] }); Recognition.latest.result('Current text'); Recognition.latest.onend?.() })
 expect(input()).toHaveValue('Current text')
})
it('ends recognition on hidden tabs and preview reset without accepting late text', async () => {
 await begin()
 fireEvent.click(microphone())
 const old = Recognition.latest
 const lateResult = old.onresult
 Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
 fireEvent(document, new Event('visibilitychange'))
 expect(old.abort).toHaveBeenCalled()
 Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
 fireEvent.click(microphone())
 const next = Recognition.latest
 fireEvent.click(screen.getByRole('button', { name: 'End preview' }))
 expect(next.abort).toHaveBeenCalled()
 act(() => lateResult?.({ results: [{ isFinal: true, 0: { transcript: 'Stale' } }] }))
 expect(screen.getByRole('button', { name: 'Start browser preview' })).toBeInTheDocument()
})
it('aborts on unsaved changes and unmount', async () => {
 const view = await begin()
 fireEvent.click(microphone())
 const first = Recognition.latest
 view.rerender(<ReceptionistPreview hasSavedSettings hasUnsavedChanges />)
 expect(first.abort).toHaveBeenCalled()
 expect(microphone()).toBeDisabled()
 view.rerender(<ReceptionistPreview hasSavedSettings hasUnsavedChanges={false} />)
 fireEvent.click(microphone())
 const second = Recognition.latest
 view.unmount()
 expect(second.abort).toHaveBeenCalled()
})
it('bounds recognized text to the message limit', async () => {
 await begin()
 fireEvent.change(input(), { target: { value: 'x'.repeat(1990) } })
 fireEvent.click(microphone())
 act(() => { Recognition.latest.result('a'.repeat(30)); Recognition.latest.onend?.() })
 expect((input() as HTMLInputElement).value).toHaveLength(2000)
 expect(screen.getByText(/message limit/i)).toBeInTheDocument()
})
it('recovers when recognition cannot start', async () => {
 vi.stubGlobal('SpeechRecognition', class extends Recognition { start = vi.fn(() => { throw new Error('synthetic private provider detail') }) })
 await begin()
 fireEvent.click(microphone())
 expect(screen.getByRole('alert')).toHaveTextContent(/could not start/i)
 expect(screen.queryByText(/synthetic private/)).not.toBeInTheDocument()
 expect(microphone()).toBeEnabled()
 expect(input()).toBeEnabled()
})
it('keeps finishing state when a delayed start event follows Stop', async () => {
 vi.stubGlobal('SpeechRecognition', class extends Recognition { start = vi.fn() })
 await begin()
 fireEvent.click(microphone())
 fireEvent.click(screen.getByRole('button', { name: 'Stop microphone' }))
 act(() => Recognition.latest.onstart?.())
 expect(screen.getByText(/finishing transcription/i)).toBeInTheDocument()
 expect(screen.getByRole('button', { name: 'Stop microphone' })).toBeDisabled()
})
it('bounds listening time and releases a recognition service that never ends', async () => {
 await begin()
 vi.useFakeTimers()
 fireEvent.click(microphone())
 const current = Recognition.latest
 act(() => { vi.advanceTimersByTime(30000) })
 expect(current.stop).toHaveBeenCalled()
 expect(screen.getByText(/finishing transcription/i)).toBeInTheDocument()
 act(() => { vi.advanceTimersByTime(5000) })
 expect(current.abort).toHaveBeenCalled()
 expect(microphone()).toBeEnabled()
 expect(input()).toBeEnabled()
})
