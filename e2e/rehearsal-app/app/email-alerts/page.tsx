import { NotificationInbox } from '@/components/notifications/notification-inbox'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { coreIds } from '../../core-fixtures'
export default function Page() { const context = { organizationId: coreIds.organization, userId: coreIds.user }; return <div className="mx-auto max-w-4xl space-y-4 p-4"><NotificationBell scope={`${context.organizationId}:${context.userId}`} emailContext={context} /><NotificationInbox emailContext={context} /></div> }
