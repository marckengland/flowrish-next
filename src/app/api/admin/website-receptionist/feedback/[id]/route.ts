import { feedbackActionSchema } from '@/lib/visitor-feedback'
import { changeVisitorFeedback } from '@/server/services/visitor-feedback'
import { feedbackResponse } from '@/server/services/visitor-feedback-http'
import { readWebsiteBody } from '@/server/services/website-receptionist-http'
export async function PATCH(request: Request, route: { params: Promise<{ id: string }> }) { return feedbackResponse(async session => changeVisitorFeedback(session.organizationId, session.dbUser.id, (await route.params).id, feedbackActionSchema.parse(await readWebsiteBody(request)))) }
