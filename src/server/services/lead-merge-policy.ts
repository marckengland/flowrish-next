import 'server-only'
// Prepared recovery changes this switch; no deployment secrets or provider calls.
export function leadMergeWritesEnabled() { return true }
