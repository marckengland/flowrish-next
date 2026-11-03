export const FEEDBACK_RETENTION_DAYS = 30
export const visitorFeedbackCutoff = () => new Date(Date.now() - FEEDBACK_RETENTION_DAYS * 86400000)
