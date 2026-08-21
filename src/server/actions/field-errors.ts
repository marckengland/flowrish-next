import type { ZodError } from 'zod'

/**
 * Flattens a `ZodError` into a `{ fieldName: message }` map keyed by the
 * top-level field path, so form actions can return per-field errors that the
 * shared `<Field error={...} />` primitive renders inline next to the matching
 * input. Only the first issue per field is kept (the most relevant one to show
 * beside the control).
 */
export function fieldErrorsFromZod(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.errors) {
    const key = issue.path[0]
    if (typeof key === 'string' && !(key in out)) {
      out[key] = issue.message
    }
  }
  return out
}
