import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/server/db/client'
import { AppError } from '@/lib/errors'
import { CallbackTimeError, callbackCalendarFromSettings, resolveCallbackTime, validateCallbackInstant, type CallbackCalendar } from '@/lib/callback-time'

export async function readCallbackCalendar(organizationId: string, db: Prisma.TransactionClient = prisma, lock = false): Promise<CallbackCalendar | null> {
  if (lock) await db.$queryRaw`SELECT id FROM "ReceptionistConfig" WHERE "organizationId"=${organizationId} FOR SHARE`
  return callbackCalendarFromSettings(await db.receptionistConfig.findUnique({ where: { organizationId }, select: { settings: true, updatedAt: true } }))
}
export function checkCallbackTime<T>(calendar: CallbackCalendar | null, run: (value: CallbackCalendar) => T): T {
  if (!calendar) throw new AppError('CALLBACK_TIME_UNAVAILABLE', 'Save valid business callback hours before choosing a time.', 400)
  try { return run(calendar) }
  catch (error) {
    if (error instanceof CallbackTimeError) throw new AppError(error.status === 409 ? 'CALLBACK_TIME_CHANGED' : 'CALLBACK_TIME_INVALID', error.message, error.status)
    throw error
  }
}
export { resolveCallbackTime, validateCallbackInstant }
