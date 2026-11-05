import { z } from 'zod'
import { AppError } from '@/lib/errors'
import { prisma } from '@/server/db/client'
import { getLeadAccessFilter } from '@/server/services/access'
import { checkDuplicates } from '@/server/services/duplicates'
import { leadMergeBody, leadMergeHttp } from '@/server/services/lead-merge-http'
const input = z.object({ leadId: z.string().uuid() }).strict()
export async function POST(request: Request) {
  return leadMergeHttp(request, async session => {
    const { leadId } = input.parse(await leadMergeBody(request))
    const filter = await getLeadAccessFilter(session.dbUser, session.organizationId)
    const lead = await prisma.lead.findFirst({ where: { id: leadId, organizationId: session.organizationId, ...filter }, select: { id: true, email: true, companyName: true } })
    if (!lead) throw new AppError('LEAD_NOT_FOUND', 'This lead is not accessible in the current business.', 404)
    return (await checkDuplicates(lead.email ?? undefined, lead.companyName ?? undefined, session.organizationId, filter)).filter(match => match.leadId !== lead.id)
  }, false)
}
