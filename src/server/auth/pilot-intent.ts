import 'server-only'
import { prisma } from '@/server/db/client'

/** Routing hint only; redemption still requires the private link and verified email. */
export async function hasPilotInvitationForEmail(
  email: string,
): Promise<boolean> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return false
  return Boolean(
    await prisma.waitlistPilotInvite.findFirst({
      where: { email: normalized },
      select: { id: true },
    }),
  )
}
