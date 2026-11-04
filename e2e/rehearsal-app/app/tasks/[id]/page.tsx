import { TaskDetailView } from '@/components/tasks/task-detail'
import { coreTask } from '../../../core-fixtures'
export default function Page() {
  return (
    <TaskDetailView task={coreTask()} canComplete={true} canReassign={false} />
  )
}
