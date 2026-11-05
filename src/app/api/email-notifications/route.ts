import { listEmailNotifications } from '@/server/services/email-notifications'
import { emailNotificationHttp } from '@/server/services/email-notification-http'
import { notificationQuery } from '@/server/services/callback-notifications-http'
export async function GET(request: Request) { return emailNotificationHttp(request, session => listEmailNotifications(session.organizationId, session.dbUser.id, notificationQuery(request))) }
