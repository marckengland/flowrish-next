import 'server-only'
import { Prisma } from '@prisma/client'
import type { FollowUpFilters } from '@/lib/follow-up-filters'
/** Selected-page filters only: authorized retained drafts remain independent. */
export function followUpFilterSql(filters:FollowUpFilters,checkedAt?:Date) {
  const progress=filters.taskProgress?Prisma.sql`"progressTaskId" IS NOT NULL AND (${filters.taskProgress==='COMPLETED'?Prisma.sql`"progressComplete"=true`:filters.taskProgress==='OPEN'?Prisma.sql`"progressComplete"=false`:Prisma.sql`"progressComplete"=false AND "progressDueDate"<${checkedAt}`})`:Prisma.sql`TRUE`
  return Prisma.sql`(${progress}) AND (${filters.search?Prisma.sql`strpos(lower("searchText"),lower(${filters.search}))>0`:Prisma.sql`TRUE`}) AND (${filters.source==='ALL'?Prisma.sql`TRUE`:Prisma.sql`"sourceType"=${filters.source}`}) AND (${filters.dueOnly?Prisma.sql`status='PENDING' AND until IS NOT NULL AND until<=timezone('UTC',statement_timestamp())`:Prisma.sql`TRUE`})`
}
