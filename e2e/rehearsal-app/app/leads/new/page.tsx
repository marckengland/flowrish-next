import { NewLeadForm } from '@/components/leads/new-lead-form'
import { coreStages } from '../../../core-fixtures'
export default function Page() {
  return (
    <div className="min-w-0 max-w-3xl space-y-5">
      <h1>New lead</h1>
      <NewLeadForm stages={coreStages} />
    </div>
  )
}
