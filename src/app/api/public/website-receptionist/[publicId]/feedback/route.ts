import { publicWebsiteResponse } from '@/server/services/website-receptionist-http'
import { submitWebsiteFeedback } from '@/server/services/website-receptionist'
export const runtime = 'nodejs'
export async function POST(request: Request, route: { params: Promise<{ publicId: string }> }) { return publicWebsiteResponse(request, true, async (body, context, token) => submitWebsiteFeedback((await route.params).publicId, token, body, context)) }
