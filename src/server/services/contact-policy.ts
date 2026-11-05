import 'server-only'
// Recovery fails closed for preference writes, enrollment and outbound lead email.
export function contactPolicyAvailable() { return true }
