'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'

export function StaffWaitlistLink(): React.JSX.Element | null {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/staff/waitlist/access', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok && !controller.signal.aborted) {
          const body = await response.json()
          if (!controller.signal.aborted)
            setAllowed(body?.data?.allowed === true)
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return allowed ? (
    <Link
      href="/staff/waitlist"
      prefetch={false}
      className="inline-flex min-h-11 items-center text-sm font-medium underline"
    >
      Flowrish waitlist inbox
    </Link>
  ) : null
}
