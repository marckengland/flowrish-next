import { publicWebsiteResponse } from '@/server/services/website-receptionist-http'
import { startWebsiteSession } from '@/server/services/website-receptionist'
export const runtime = 'nodejs'
export async function POST(request: Request, route: { params: Promise<{ publicId: string }> }) { return publicWebsiteResponse(request, false, async (body, context) => startWebsiteSession((await route.params).publicId, body, context)) }
