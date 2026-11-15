# Follow-up activity filters

Filter the full saved personal history by approved, dismissed, snoozed, woke, or restored action. All actions remains the default. A named native select in the open activity region changes only that region and starts at page 1. Paging, refresh, focus refresh, source revision refresh, failure retry, and closing/reopening keep the selected action. Parent drafts, reviews, uncertain results, and blocked retries remain mounted and untouched.

## Approach

Use the existing PostgreSQL JSON discriminator fields through Prisma before offset pagination. This is standard database filtering, with the existing validated safe projection after reading. Client-only filtering misses older events; a new indexed event table would require a migration and dual writes. No schema or dependency changes are needed. Unsupported legacy records can leave a short or empty scanned page; Older remains available when another matching candidate page exists. Adding a new action later requires coordinated query and decoder changes.

Keep current user/workspace/assignee/lead/task checks before and after the read. Echo the chosen kind in the receipt and reject mismatches or wrong-kind entries. Accept legacy receipts only for All. Never expose raw audit JSON. Use existing abort and request-identity fences to ignore late responses after switching filters, closing, changing source revision, or switching account/workspace.

## Verification

Tests prove each kind is filtered before pagination, old records remain findable, malformed records stay private, pagination and current state remain independent, and delayed or failed reads cannot replace the selected filter. Browser checks exercise desktop/mobile, an edited unsent draft and blocked send, an active review, paging/retries, stale responses and access revocation. Run the disposable synthetic database drill, all unit tests, lint, production and rehearsal builds, both type checks after builds, and the full mocked browser rehearsal. Keep all existing assertions and guards. No real AI, emails, widget changes, or production data mutations.
