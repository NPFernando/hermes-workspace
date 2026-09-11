import type { ClaudeTask } from '@/lib/tasks-api'

export type TaskOperationFilter =
  | 'all'
  | 'dispatched'
  | 'timed_out'
  | 'rescued'
  | 'replanned'

export const TASK_OPERATION_FILTERS: Array<TaskOperationFilter> = [
  'all',
  'dispatched',
  'timed_out',
  'rescued',
  'replanned',
]

const TASK_OPERATION_ACTIONS: Record<
  Exclude<TaskOperationFilter, 'all'>,
  ReadonlySet<string>
> = {
  dispatched: new Set(['dispatching', 'dispatched']),
  timed_out: new Set(['timed_out']),
  rescued: new Set(['rescued']),
  replanned: new Set(['replan_requested', 'replanned']),
}

export function getTaskOperationFilterLabel(
  filter: TaskOperationFilter,
): string {
  switch (filter) {
    case 'all':
      return 'All operations'
    case 'dispatched':
      return 'Dispatched'
    case 'timed_out':
      return 'Timed out'
    case 'rescued':
      return 'Rescued'
    case 'replanned':
      return 'Replanned'
  }
}

export function doesTaskMatchOperationFilter(
  task: Pick<ClaudeTask, 'agent_history'>,
  filter: TaskOperationFilter,
): boolean {
  if (filter === 'all') return true
  const actions = TASK_OPERATION_ACTIONS[filter]
  return (task.agent_history ?? []).some((entry) => actions.has(entry.action))
}

export type TaskNotificationEvent = {
  taskId: string
  taskTitle: string
  action: string
  at: string
  note: string
  by: string
}

const TASK_NOTIFICATION_ACTIONS = new Set([
  'completed',
  'blocked',
  'question',
  'timed_out',
  'rescued',
  'planned',
])

export function getRecentTaskNotificationEvents(
  tasks: Array<{
    id: string
    title: string
    agent_history?: Array<{
      id?: string
      action?: string
      at?: string
      note?: string
      by?: string
      byEmoji?: string
    }>
  }>,
  nowMs = Date.now(),
  maxEvents = 60,
): Array<TaskNotificationEvent> {
  const cutoff = new Date(nowMs - 24 * 60 * 60_000).toISOString()
  const events: Array<TaskNotificationEvent> = []

  for (const task of tasks) {
    for (const historyEntry of task.agent_history ?? []) {
      const action = historyEntry.action ?? ''
      const at = historyEntry.at ?? ''
      if (!at || at < cutoff || !TASK_NOTIFICATION_ACTIONS.has(action)) continue
      events.push({
        taskId: task.id,
        taskTitle: task.title,
        action,
        at,
        note: historyEntry.note ?? '',
        by: historyEntry.by ?? 'astra',
      })
    }
  }

  events.sort((a, b) => b.at.localeCompare(a.at))
  return events.slice(0, Math.max(0, maxEvents))
}

export function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      el.isContentEditable)
  )
}

export const TASKS_BOARD_HELP_TEXT =
  'Workspace Tasks is a lightweight task board. Drag cards to change status. Use Dashboard Kanban for native multi-board controls.'

export const TASK_STATS_ROW_CLASS =
  'mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-nowrap text-[11px] text-[var(--theme-muted)]'

function pluralizeTask(count: number) {
  return count === 1 ? 'task' : 'tasks'
}

export function formatTaskFilterSummary(
  matchCount: number,
  totalTasks: number,
) {
  if (totalTasks === 0) return 'No tasks yet'
  if (matchCount === 0)
    return `No matches across ${totalTasks} ${pluralizeTask(totalTasks)}`
  if (matchCount === totalTasks)
    return `Showing all ${totalTasks} ${pluralizeTask(totalTasks)}`
  return `Showing ${matchCount} of ${totalTasks} ${pluralizeTask(totalTasks)}`
}

export function formatTaskFilterAriaLabel(label: string, active: boolean) {
  return `${active ? 'Disable' : 'Enable'} ${label.toLowerCase()} task filter`
}

export function formatTaskRefreshStatus(
  isFetching: boolean,
  isInitialLoading: boolean,
) {
  if (isInitialLoading) return 'Loading task board…'
  if (isFetching) return 'Updating task board…'
  return null
}

export function formatTaskLastUpdated(
  updatedAtMs: number,
  nowMs = Date.now(),
): string | null {
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return null
  const ageMs = Math.max(0, nowMs - updatedAtMs)
  if (ageMs < 60_000) return 'Updated just now'
  if (ageMs < 3_600_000)
    return `Updated ${Math.max(1, Math.floor(ageMs / 60_000))}m ago`
  if (ageMs < 86_400_000)
    return `Updated ${Math.max(1, Math.floor(ageMs / 3_600_000))}h ago`
  return `Updated ${Math.max(1, Math.floor(ageMs / 86_400_000))}d ago`
}

export function formatCompactTaskColumnAriaLabel(
  label: string,
  taskCount: number,
) {
  if (taskCount === 0)
    return `${label} column is empty. Add a task or drop one here.`
  return `${label} column with ${taskCount} ${pluralizeTask(taskCount)}`
}

export function formatCompactTaskColumnActionLabel(label: string) {
  return `Add a task to the ${label} column`
}

export function formatBlockedTaskBreakdownLabel(
  waitingForInput: number,
  executionFailures: number,
) {
  if (waitingForInput > 0 && executionFailures > 0)
    return `${waitingForInput} input · ${executionFailures} err`
  if (waitingForInput > 0) return 'needs input'
  if (executionFailures > 0) return 'exec error'
  return null
}

type ExecutableReviewCandidate = Pick<
  ClaudeTask,
  'column' | 'agent_history'
> & { agent_state?: ClaudeTask['agent_state'] }

export function countExecutableReviewTasks(
  tasks: Array<ExecutableReviewCandidate>,
) {
  return tasks.filter((task) => {
    if (task.column !== 'review' || task.agent_state) return false
    const plannedHistory = (task.agent_history ?? []).filter(
      (entry) => entry.action === 'planned',
    )
    if (plannedHistory.length === 0) return false
    const lastNote = plannedHistory[plannedHistory.length - 1].note
    return !lastNote.includes('Plan unavailable') && lastNote.length >= 80
  }).length
}

export function formatBlockedTaskBreakdownTitle(
  waitingForInput: number,
  executionFailures: number,
) {
  return [
    waitingForInput > 0 ? `${waitingForInput} waiting for input` : '',
    executionFailures > 0
      ? `${executionFailures} execution failure${executionFailures === 1 ? '' : 's'}`
      : '',
  ]
    .filter(Boolean)
    .join(', ')
}
