import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { readWebsiteBody } from '@/server/services/website-receptionist-http'
import { getWebsiteReceptionistAdmin, saveWebsiteReceptionist } from '@/server/services/website-receptionist'
export async function GET() { return rehearsalResponse(session => getWebsiteReceptionistAdmin(session.organizationId, session.dbUser.id)) }
export async function PUT(request: Request) { return rehearsalResponse(async session => saveWebsiteReceptionist(session.organizationId, session.dbUser.id, await readWebsiteBody(request))) }
