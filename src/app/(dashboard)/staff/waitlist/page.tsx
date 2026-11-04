import { notFound } from 'next/navigation'
import { requireSession } from '@/server/auth/session'
import { assertWaitlistStaff } from '@/server/auth/waitlist-staff'
import { AppError } from '@/lib/errors'
import { StaffWaitlistInbox } from '@/components/admin/staff-waitlist-inbox'

export const metadata = {
  title: 'Flowrish waitlist inbox',
  robots: { index: false, follow: false },
}
export default async function StaffWaitlistPage(): Promise<React.JSX.Element> {
  const session = await requireSession()
  try {
    await assertWaitlistStaff(session.organizationId, session.dbUser.id)
  } catch (error) {
    if (error instanceof AppError && error.statusCode === 403) notFound()
    throw error
  }
  return <StaffWaitlistInbox />
}
