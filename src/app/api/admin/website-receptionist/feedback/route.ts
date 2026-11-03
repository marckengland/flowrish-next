import { feedbackQuerySchema } from '@/lib/visitor-feedback'
import { readGapQuery } from '@/server/services/knowledge-gaps-http'
import { getVisitorFeedbackList } from '@/server/services/visitor-feedback'
import { feedbackResponse } from '@/server/services/visitor-feedback-http'
export async function GET(request: Request) { return feedbackResponse(session => getVisitorFeedbackList(session.organizationId, session.dbUser.id, feedbackQuerySchema.parse(readGapQuery(request)))) }
