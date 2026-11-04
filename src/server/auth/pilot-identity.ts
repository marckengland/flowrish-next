import 'server-only'
import { createSupabaseServer } from '@/lib/supabase/server'
import { prisma } from '@/server/db/client'
import type { PilotIdentity } from '@/server/services/pilot-onboarding'

export async function getPilotIdentity(): Promise<PilotIdentity | null> {
  const supabase = await createSupabaseServer()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user?.email || !user.email_confirmed_at) return null
  const dbUser = await prisma.user.findUnique({
    where: { authId: user.id },
    select: { id: true },
  })
  return dbUser
    ? {
        userId: dbUser.id,
        email: user.email.trim().toLowerCase(),
        verified: true,
      }
    : null
}
