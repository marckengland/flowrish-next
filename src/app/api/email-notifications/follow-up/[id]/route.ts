import { focusedEmailFollowUp } from '@/server/services/email-notifications'
import { emailNotificationHttp } from '@/server/services/email-notification-http'
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { return emailNotificationHttp(request, async session => focusedEmailFollowUp(session.organizationId, session.dbUser.id, (await context.params).id)) }
