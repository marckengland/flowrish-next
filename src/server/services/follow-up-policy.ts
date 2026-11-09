import 'server-only'
// Recovery pauses follow-up writes and manual delivery without undoing access checks.
export function followUpWritesEnabled() { return process.env.FLOWRISH_FOLLOW_UP_WRITES_PAUSED !== 'true' }
