import { NotificationInbox } from '@/components/notifications/notification-inbox'
import { requireSession } from '@/server/auth/session'
export default async function NotificationsPage(): Promise<React.JSX.Element> { const session = await requireSession(); return <NotificationInbox key={`${session.organizationId}:${session.dbUser.id}`} /> }
