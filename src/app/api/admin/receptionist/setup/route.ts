import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { getReceptionistSetup } from '@/server/services/receptionist-setup'
export async function GET() { return rehearsalResponse(session => getReceptionistSetup(session.organizationId, session.dbUser.id)) }
