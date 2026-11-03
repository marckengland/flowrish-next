import { feedbackFaqInputSchema } from '@/lib/visitor-feedback'
import { createVisitorFeedbackFaq } from '@/server/services/visitor-feedback'
import { feedbackResponse } from '@/server/services/visitor-feedback-http'
import { readWebsiteBody } from '@/server/services/website-receptionist-http'
export async function POST(request: Request, route: { params: Promise<{ id: string }> }) { return feedbackResponse(async session => createVisitorFeedbackFaq(session.organizationId, session.dbUser.id, (await route.params).id, feedbackFaqInputSchema.parse(await readWebsiteBody(request)))) }
