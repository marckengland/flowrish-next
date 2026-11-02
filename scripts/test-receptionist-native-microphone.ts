import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { initialCallState } from '../src/lib/receptionist'

// Opt-in native speech test: pass a synthetic AudioContext track to native recognition.
// Physical microphone access is denied; recognition events and text remain native.
assert.equal(process.env.E2E_NATIVE_MIC, '1', 'Set E2E_NATIVE_MIC=1 to run the native browser speech test.')
const audioFile = process.env.E2E_MIC_AUDIO_FILE
assert(audioFile && isAbsolute(audioFile) && existsSync(audioFile), 'Provide an absolute path to a synthetic WAV in E2E_MIC_AUDIO_FILE.')
const baseURL = process.env.PLAYWRIGHT_BASE_URL
assert(baseURL && /^https?:\/\//.test(baseURL), 'Set PLAYWRIGHT_BASE_URL to the app under test.')
async function main() {
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--deny-permission-prompts'] })
const context = await browser.newContext({ baseURL, storageState: 'e2e/.auth/user.json' })
const page = await context.newPage()
page.setDefaultTimeout(20000)
const session = await context.newCDPSession(page)
const { targetInfo } = await session.send('Target.getTargetInfo')
await session.send('Browser.setPermission', { permission: { name: 'microphone' }, setting: 'denied', origin: new URL(baseURL!).origin, browserContextId: targetInfo.browserContextId })
const report: Record<string, unknown> = { baseURL, recognition: 'native', audio: 'synthetic file', ai: 'fixture', passed: false }
let previewRequests = 0, voiceRequests = 0
page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/voice/')) voiceRequests++ })
try {
  // Isolate native acoustic recognition from provider usage and persistent setup.
  await page.route('**/api/admin/receptionist**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/preview')) {
      previewRequests++
      const input = route.request().postDataJSON()
      return route.fulfill({ json: { data: { state: initialCallState(''), settingsVersion: 'native-mic-sample', reply: input.speech ? 'A sample tune-up costs PHP 750.' : 'Hello from Sample Cycles.', finished: false, callback: null, sources: [] } } })
    }
    return route.fulfill({ json: { config: { enabled: false, businessName: 'Sample Cycles', knowledge: 'A sample tune-up costs PHP 750.', mode: 'always', timeZone: 'Asia/Manila', opensAt: '09:00', closesAt: '17:00', businessDays: [1, 2, 3, 4, 5], forwardTo: '', assigneeId: '', stageId: '' }, businessName: 'Sample Workspace', members: [], stages: [], calls: [] } })
  })
  await page.route('**/__synthetic_receptionist_audio.wav', route => route.fulfill({ path: audioFile!, contentType: 'audio/wav' }))
  const document = await page.goto('/settings')
  report.permissionsPolicy = document?.headers()['permissions-policy']
  assert.match(String(report.permissionsPolicy), /microphone=\(self\)/, 'The app document must permit same-origin microphone requests.')
  await page.getByRole('button', { name: 'AI receptionist', exact: true }).click()
  await page.getByRole('button', { name: 'Start browser preview', exact: true }).click()
  await page.getByRole('combobox', { name: 'Recognition language' }).selectOption('en-US')
  await page.evaluate(async () => {
    type NativeRecognition = { start(track: MediaStreamTrack): void }
    const target = window as unknown as { SpeechRecognition?: { prototype: NativeRecognition }; webkitSpeechRecognition?: { prototype: NativeRecognition } }
    const Constructor = target.SpeechRecognition ?? target.webkitSpeechRecognition
    if (!Constructor) throw new Error('Native speech recognition is unavailable.')
    const microphone = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    if (microphone.state !== 'denied') throw new Error('The test must deny physical microphone permission.')
    const audio = new AudioContext()
    const buffer = await audio.decodeAudioData(await (await fetch('/__synthetic_receptionist_audio.wav')).arrayBuffer())
    const source = audio.createBufferSource()
    source.buffer = buffer
    const destination = audio.createMediaStreamDestination()
    source.connect(destination)
    const track = destination.stream.getAudioTracks()[0]
    const start = Constructor.prototype.start
    Constructor.prototype.start = function () {
      start.call(this, track)
      void audio.resume().then(() => source.start())
    }
  })
  report.physicalMicrophonePermission = 'denied'
  report.input = 'explicit synthetic audio track'
  await page.getByRole('button', { name: 'Use microphone', exact: true }).click()
  const message = page.getByRole('textbox', { name: 'Caller message' })
  await expect(message).toHaveValue(/bicycle|tune.?up/i, { timeout: 40000 })
  await expect(message).toBeEnabled({ timeout: 10000 })
  report.transcript = await message.inputValue()
  assert.equal(previewRequests, 1, 'Dictation must not submit automatically.')
  await page.getByRole('button', { name: 'Send caller message' }).click()
  await expect(page.getByRole('log', { name: 'Preview conversation' })).toContainText('PHP 750')
  assert.equal(previewRequests, 2)
  assert.equal(voiceRequests, 0)
  await page.screenshot({ path: '/tmp/flowrish-receptionist-native-microphone.png', fullPage: true })
  report.passed = true
  console.log(JSON.stringify(report))
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Native microphone test failed'
  report.alerts = await page.getByRole('alert').allTextContents()
  await page.screenshot({ path: '/tmp/flowrish-receptionist-native-microphone-failure.png', fullPage: true }).catch(() => {})
  console.error(JSON.stringify(report))
  process.exitCode = 1
} finally {
  writeFileSync('/tmp/flowrish-receptionist-native-microphone-report.json', JSON.stringify({ ...report, previewRequests, voiceRequests }, null, 2), { mode: 0o600 })
  await browser.close()
}
}
main().catch(() => { console.error('Could not run native microphone verification. Check the browser and test authentication.'); process.exitCode = 1 })
