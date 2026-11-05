import { countEmailNotifications } from '@/server/services/email-notifications'
import { emailNotificationHttp } from '@/server/services/email-notification-http'
export async function GET(request: Request) { return emailNotificationHttp(request, session => countEmailNotifications(session.organizationId, session.dbUser.id)) }
