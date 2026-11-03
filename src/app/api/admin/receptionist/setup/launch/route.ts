import { rehearsalResponse } from '@/server/services/receptionist-rehearsal-http'
import { readSetupBody } from '@/server/services/receptionist-setup-http'
import { launchReceptionistSetup } from '@/server/services/receptionist-setup'
export async function POST(request: Request) { return rehearsalResponse(async session => launchReceptionistSetup(session.organizationId, session.dbUser.id, await readSetupBody(request))) }
