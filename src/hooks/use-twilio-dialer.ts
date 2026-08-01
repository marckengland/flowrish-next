'use client'

import { useCallback, useRef, useState } from 'react'
import type { Call, Device } from '@twilio/voice-sdk'

export type DialerStatus =
  | 'idle'
  | 'connecting'
  | 'in-call'
  | 'ended'
  | 'error'

interface TokenResponse {
  configured?: boolean
  token?: string
  identity?: string
  orgId?: string
  callerId?: string
}

/**
 * In-browser outbound calling via the Twilio Voice SDK.
 *
 * `start()` fetches a short-lived access token from `/api/voice/token`.
 * If Twilio isn't configured server-side it resolves `'unavailable'` so
 * the caller can fall back to free `tel:` dialing. Otherwise it registers
 * a `Device`, places the call through the org's TwiML app, and tracks the
 * call lifecycle. The SDK is imported dynamically so it never runs during
 * SSR and stays out of the initial bundle.
 */
export function useTwilioDialer() {
  const [status, setStatus] = useState<DialerStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const deviceRef = useRef<Device | null>(null)
  const callRef = useRef<Call | null>(null)

  const cleanup = useCallback(() => {
    try {
      deviceRef.current?.destroy()
    } catch {
      // ignore teardown errors
    }
    callRef.current = null
    deviceRef.current = null
  }, [])

  const hangup = useCallback(() => {
    try {
      callRef.current?.disconnect()
    } catch {
      // ignore
    }
    cleanup()
    setStatus('ended')
  }, [cleanup])

  const reset = useCallback(() => {
    cleanup()
    setStatus('idle')
    setError(null)
  }, [cleanup])

  const start = useCallback(
    async (toNumber: string): Promise<'connected' | 'unavailable'> => {
      setError(null)

      let data: TokenResponse
      try {
        const res = await fetch('/api/voice/token', {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' },
        })
        data = (await res.json()) as TokenResponse
        if (!res.ok || !data.configured || !data.token) return 'unavailable'
      } catch {
        return 'unavailable'
      }

      try {
        const { Device } = await import('@twilio/voice-sdk')
        const device = new Device(data.token)
        deviceRef.current = device
        device.on('error', (e: { message?: string }) =>
          setError(e?.message ?? 'Device error'),
        )

        setStatus('connecting')
        const call = await device.connect({
          params: { To: toNumber, OrgId: data.orgId ?? '' },
        })
        callRef.current = call

        call.on('accept', () => setStatus('in-call'))
        call.on('disconnect', () => {
          setStatus('ended')
          cleanup()
        })
        call.on('cancel', () => {
          setStatus('ended')
          cleanup()
        })
        call.on('error', (e: { message?: string }) => {
          setError(e?.message ?? 'Call error')
          setStatus('error')
        })

        return 'connected'
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not start the call')
        cleanup()
        setStatus('error')
        return 'unavailable'
      }
    },
    [cleanup],
  )

  return { status, error, start, hangup, reset }
}
