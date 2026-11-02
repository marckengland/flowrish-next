'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  start(): void
  stop(): void
  abort(): void
}
type RecognitionConstructor = new () => Recognition
function recognitionConstructor(): RecognitionConstructor | undefined {
  const browser = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return window.isSecureContext === false ? undefined : browser.SpeechRecognition ?? browser.webkitSpeechRecognition
}
const errors: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow microphone access in your browser settings, or type your message.',
  'audio-capture': 'No microphone is available. Check your device, or type your message.',
  'network': 'Speech recognition could not connect. Check your connection, or type your message.',
  'no-speech': 'No speech was recognized. Try again, or type your message.',
  'service-not-allowed': 'Speech recognition is unavailable in this browser. Try another supported browser, or type your message.',
  'language-not-supported': 'This recognition language is unavailable. Choose another language, or type your message.',
}

export function ReceptionistMicrophone({ value, onChange, disabled, onActiveChange }: {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  onActiveChange: (active: boolean) => void
}): React.JSX.Element {
  const [supported, setSupported] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'starting' | 'listening' | 'stopping'>('idle')
  const [language, setLanguage] = useState('en-PH')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [limited, setLimited] = useState(false)
  const current = useRef<Recognition | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const finishingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const stop = useRef<(() => void) | null>(null)
  const active = phase !== 'idle'

  const dispose = useCallback(() => {
    clearTimeout(timer.current)
    clearTimeout(finishingTimer.current)
    stop.current = null
    const recognition = current.current
    current.current = null
    if (recognition) {
      recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null
      try { recognition.abort() } catch { /* The browser may already have ended recognition. */ }
    }
  }, [])
  const finish = useCallback((message = '') => {
    dispose()
    setPhase('idle')
    setInterim('')
    setError(message)
    onActiveChange(false)
  }, [dispose, onActiveChange])

  useEffect(() => {
    setSupported(Boolean(recognitionConstructor()))
    const leave = () => { if (current.current) finish() }
    const visibility = () => { if (document.visibilityState === 'hidden') leave() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', leave)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', leave)
      dispose()
    }
  }, [dispose, finish])
  useEffect(() => { if (disabled && current.current) finish() }, [disabled, finish])

  function start() {
    if (disabled || current.current) return
    const Constructor = recognitionConstructor()
    if (!Constructor) return
    setError('')
    setLimited(false)
    setInterim('')
    setPhase('starting')
    onActiveChange(true)
    let received = false
    try {
      window.speechSynthesis?.cancel()
      const recognition = new Constructor()
      current.current = recognition
      recognition.lang = language
      recognition.continuous = false
      recognition.interimResults = true
      recognition.maxAlternatives = 1
      recognition.onstart = () => { if (current.current === recognition) setPhase(previous => previous === 'starting' ? 'listening' : previous) }
      recognition.onresult = (event) => {
        if (current.current !== recognition) return
        const results = Array.from(event.results)
        const final = results.filter(result => result.isFinal).map(result => result[0].transcript.trim()).filter(Boolean).join(' ')
        setInterim(results.filter(result => !result.isFinal).map(result => result[0].transcript).join(' ').slice(0, 2000))
        if (final) {
          received = true
          const text = [value.trim(), final].filter(Boolean).join(' ')
          onChange(text.slice(0, 2000))
          setLimited(text.length > 2000)
        }
      }
      recognition.onerror = event => {
        if (current.current === recognition) finish(errors[event.error] ?? 'Speech recognition stopped. Try again, or type your message.')
      }
      recognition.onend = () => {
        if (current.current === recognition) finish(received ? '' : errors['no-speech'])
      }
      stop.current = () => {
        if (current.current !== recognition) return
        clearTimeout(timer.current)
        setPhase('stopping')
        finishingTimer.current = setTimeout(() => {
          if (current.current === recognition) finish(received ? '' : errors['no-speech'])
        }, 5000)
        try { recognition.stop() } catch { finish('The microphone stopped. Review your text, or try again.') }
      }
      timer.current = setTimeout(() => stop.current?.(), 30000)
      recognition.start()
    } catch {
      finish('Microphone input could not start. Check browser microphone permissions, or type your message.')
    }
  }

  return <div className="space-y-2 text-sm">
    <p className="text-xs text-muted-foreground">Microphone input uses your browser’s speech service, which may send audio for processing. Flowrish receives the text only when you send it. Review names and phone numbers before sending.</p>
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" disabled={disabled || !supported || phase === 'stopping'} onClick={active ? () => stop.current?.() : start}>
        {active ? <Square className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}
        {active ? 'Stop microphone' : 'Use microphone'}
      </Button>
      {active && <Button type="button" variant="outline" onClick={() => finish()}>Cancel microphone</Button>}
      <label className="flex min-h-11 items-center gap-2 text-xs">Recognition language<select className="min-h-11 rounded-md border bg-background px-2 text-sm" value={language} disabled={disabled || active || !supported} onChange={event => setLanguage(event.target.value)}><option value="en-PH">English (Philippines)</option><option value="en-US">English (US)</option><option value="fil-PH">Filipino</option></select></label>
    </div>
    {!supported && <p className="text-xs text-muted-foreground">Microphone input is unavailable in this browser. Use a supported browser over HTTPS, or type your message.</p>}
    {active && <p role="status" className="text-xs text-muted-foreground">{phase === 'starting' ? 'Waiting for microphone permission…' : phase === 'stopping' ? 'Finishing transcription…' : 'Listening… Speak now, then stop or pause. Listening ends after 30 seconds.'}</p>}
    {interim && <p className="break-words text-xs text-muted-foreground">Hearing: {interim}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {limited && <p className="text-xs text-muted-foreground">The message limit is 2,000 characters. Extra speech was omitted; review your message.</p>}
  </div>
}
