import { bulkLeadBody, bulkLeadHttp } from '@/server/services/bulk-lead-http'
import { applyBulkLeadUpdate } from '@/server/services/bulk-lead-updates'
export async function POST(request: Request) {
  return bulkLeadHttp(request, async session => applyBulkLeadUpdate(session.organizationId, session.dbUser.id, await bulkLeadBody(request)))
}
