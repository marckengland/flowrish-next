import 'server-only'
import { prisma } from '@/server/db/client'
import { visitorFeedbackCutoff } from '@/lib/visitor-feedback-retention'
// Kept in the rollback so consented question text still expires when the inbox is disabled.
export async function cleanupVisitorFeedback() {
  const day = new Date(); day.setUTCHours(0, 0, 0, 0); day.setUTCDate(day.getUTCDate() - 2)
  const [result] = await prisma.$transaction([prisma.websiteReceptionistFeedback.deleteMany({ where: { createdAt: { lte: visitorFeedbackCutoff() } } }), prisma.websiteReceptionistFeedbackUsage.deleteMany({ where: { day: { lt: day } } })])
  return result.count
}
