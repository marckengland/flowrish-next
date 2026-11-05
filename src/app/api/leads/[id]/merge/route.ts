import { AppError } from '@/lib/errors'
import { leadMergeHttp } from '@/server/services/lead-merge-http'
/** Older clients must reload and use the immutable review/confirmation flow. */
export async function POST(request: Request) {
  return leadMergeHttp(request, async () => { throw new AppError('MERGE_REVIEW_REQUIRED', 'Reload this lead and review the merge before confirming.', 409) })
}
