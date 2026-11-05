import { AppError } from '@/lib/errors'
import { bulkLeadHttp } from '@/server/services/bulk-lead-http'
import { bulkLeadOptions } from '@/server/services/bulk-lead-updates'
export async function GET(request: Request) {
  return bulkLeadHttp(request, session => {
    if (new URL(request.url).search) throw new AppError('VALIDATION_ERROR', 'Bulk options do not accept query filters.', 400)
    return bulkLeadOptions(session.organizationId, session.dbUser.id)
  })
}
