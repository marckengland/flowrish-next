import 'server-only'
// Recovery pauses snooze writes without removing visibility or reminder filters.
export function followUpSnoozeWritesEnabled() { return true }
