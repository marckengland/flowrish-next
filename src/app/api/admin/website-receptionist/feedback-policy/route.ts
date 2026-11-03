import { AppError } from '@/lib/errors'
import { feedbackPolicyInputSchema } from '@/lib/visitor-feedback'
import { getVisitorFeedbackPolicy, saveVisitorFeedbackPolicy } from '@/server/services/visitor-feedback'
import { feedbackResponse } from '@/server/services/visitor-feedback-http'
import { readWebsiteBody } from '@/server/services/website-receptionist-http'
function noQuery(request: Request) { if (new URL(request.url).search) throw new AppError('VALIDATION_ERROR', 'Feedback settings use the current organization without filters.', 400) }
export async function GET(request: Request) { return feedbackResponse(session => { noQuery(request); return getVisitorFeedbackPolicy(session.organizationId, session.dbUser.id) }) }
export async function PATCH(request: Request) { return feedbackResponse(async session => { noQuery(request); return saveVisitorFeedbackPolicy(session.organizationId, session.dbUser.id, feedbackPolicyInputSchema.parse(await readWebsiteBody(request))) }) }
