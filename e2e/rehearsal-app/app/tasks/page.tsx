import { TaskList } from '@/components/tasks/task-list'
import { TaskForm } from '@/components/tasks/task-form'
import { coreLead, coreTask, coreIds } from '../../core-fixtures'
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ readonly?: string }>
}) {
  const params = await searchParams,
    canWrite = params.readonly !== 'true'
  return (
    <div className="min-w-0 space-y-5">
      <h1>Tasks</h1>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <TaskList
          initialTasks={[coreTask()]}
          canComplete={canWrite}
          canReassign={false}
        />
        {canWrite ? (
          <aside className="min-w-0 rounded-lg border p-4">
            <h2>New task</h2>
            <TaskForm
              leads={[coreLead()]}
              assignees={[
                {
                  id: coreIds.user,
                  name: 'Practice Owner',
                  email: 'owner@example.test',
                },
              ]}
              defaultAssigneeId={coreIds.user}
            />
          </aside>
        ) : (
          <p>You don&apos;t have permission to create tasks.</p>
        )}
      </div>
    </div>
  )
}
