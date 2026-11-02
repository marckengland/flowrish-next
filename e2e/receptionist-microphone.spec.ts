import { expect, test, type Page } from '@playwright/test'
import { initialCallState } from '../src/lib/receptionist'

const version = '2026-11-02T00:00:00Z'
interface TestRecognition {
  onstart?: () => void
  onend?: () => void
  onerror?: (event: { error: string }) => void
  onresult?: (event: { results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => void
}
type MicWindow = Window & { __microphone?: TestRecognition }
async function setup(page: Page, supported = true) {
  const inputs: Array<Record<string, unknown>> = []
  await page.addInitScript((enabled) => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: enabled ? class {
      constructor() { (window as MicWindow).__microphone = this }
      onstart?: () => void
      onend?: () => void
      start() { this.onstart?.() }
      stop() { this.onend?.() }
      abort() {}
    } : undefined })
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined })
  }, supported)
  await page.route('**/api/admin/receptionist**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/preview')) {
      const input = route.request().postDataJSON()
      inputs.push(input)
      return route.fulfill({ json: { data: { state: initialCallState(''), settingsVersion: version, reply: input.speech ? 'A tune-up costs PHP 750.' : 'Hello from Synthetic Cycles.', finished: false, callback: null, sources: [], ...(input.speech ? { generation: { mode: 'ai' } } : {}) } } })
    }
    return route.fulfill({ json: { config: { enabled: false, businessName: 'Synthetic Cycles', knowledge: 'Tune-ups cost PHP 750.', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: '', stageId: '' }, businessName: 'Synthetic Workspace', members: [], stages: [], calls: [] } })
  })
  await page.goto('/settings')
  await page.getByRole('button', { name: 'AI receptionist', exact: true }).click()
  await page.getByRole('button', { name: 'Start browser preview', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Caller message' })).toBeVisible()
  return inputs
}

test('reviews dictated text before sending and renders the reply without voice requests', async ({ page }) => {
  let voiceRequests = 0
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/voice/')) voiceRequests++ })
  const inputs = await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByText(/browser’s speech service/)).toBeVisible()
  await page.getByRole('button', { name: 'Use microphone', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Send caller message' })).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Recognition language' })).toBeDisabled()
  await page.evaluate(() => {
    const recognition = (window as MicWindow).__microphone!
    recognition.onresult?.({ results: [{ isFinal: false, 0: { transcript: 'How much is a tune-up' } }] })
  })
  await expect(page.getByText('Hearing: How much is a tune-up')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Caller message' })).toHaveValue('')
  await page.evaluate(() => {
    const recognition = (window as MicWindow).__microphone!
    recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'How much is a tune-up?' } }] })
    recognition.onend?.()
  })
  await expect(page.getByRole('textbox', { name: 'Caller message' })).toHaveValue('How much is a tune-up?')
  expect(inputs).toEqual([{}])
  await page.getByRole('textbox', { name: 'Caller message' }).fill('How much does a basic tune-up cost?')
  await page.getByRole('button', { name: 'Send caller message' }).click()
  await expect(page.getByRole('log', { name: 'Preview conversation' })).toContainText('PHP 750')
  expect(inputs[1]).toMatchObject({ speech: 'How much does a basic tune-up cost?', settingsVersion: version })
  expect(voiceRequests).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('recovers from blocked microphone permission with usable text input', async ({ page }) => {
  const inputs = await setup(page)
  await page.getByRole('button', { name: 'Use microphone', exact: true }).click()
  await page.evaluate(() => (window as MicWindow).__microphone!.onerror?.({ error: 'not-allowed' }))
  await expect(page.getByRole('alert').filter({ hasText: 'Microphone access was blocked' })).toContainText('Microphone access was blocked')
  await page.getByRole('textbox', { name: 'Caller message' }).fill('Typed question')
  await page.getByRole('button', { name: 'Send caller message' }).click()
  await expect(page.getByRole('log', { name: 'Preview conversation' })).toContainText('PHP 750')
  expect(inputs[1]).toMatchObject({ speech: 'Typed question' })
})

test('explains unsupported recognition and retains typed conversations', async ({ page }) => {
  await setup(page, false)
  await expect(page.getByRole('button', { name: 'Use microphone', exact: true })).toBeDisabled()
  await expect(page.getByText(/microphone input is unavailable/i)).toBeVisible()
  await page.getByRole('textbox', { name: 'Caller message' }).fill('A typed message')
  await expect(page.getByRole('button', { name: 'Send caller message' })).toBeEnabled()
})
