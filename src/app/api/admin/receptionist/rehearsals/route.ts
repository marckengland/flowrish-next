import { rehearsalResponse, readRehearsalBody } from '@/server/services/receptionist-rehearsal-http'
import { createRehearsal, listRehearsals } from '@/server/services/receptionist-rehearsals'

export async function GET() {
  return rehearsalResponse(session => listRehearsals(session.organizationId, session.dbUser.id))
}
export async function POST(request: Request) {
  return rehearsalResponse(async session => createRehearsal(session.organizationId, session.dbUser.id, await readRehearsalBody(request)))
}
