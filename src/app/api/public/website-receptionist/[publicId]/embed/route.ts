import { websiteEmbedResponse } from '@/server/services/website-receptionist-http'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request: Request, context: { params: Promise<{ publicId: string }> }) { return websiteEmbedResponse(request, (await context.params).publicId) }
