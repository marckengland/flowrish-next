import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { readSetupBody } from '@/server/services/receptionist-setup-http'
import { saveReceptionistSetupBusiness } from '@/server/services/receptionist-setup'
export async function PATCH(request: Request) { return rehearsalResponse(async session => saveReceptionistSetupBusiness(session.organizationId, session.dbUser.id, await readSetupBody(request))) }
