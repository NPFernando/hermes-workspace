import type { ClaudeTask } from '@/lib/tasks-api'

export function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}

export const TASKS_BOARD_HELP_TEXT =
  'Workspace Tasks is a lightweight task board. Drag cards to change status. Use Dashboard Kanban for native multi-board controls.'

function pluralizeTask(count: number) {
  return count === 1 ? 'task' : 'tasks'
}

export function formatTaskFilterSummary(matchCount: number, totalTasks: number) {
  if (totalTasks === 0) return 'No tasks yet'
  if (matchCount === 0) return `No matches across ${totalTasks} ${pluralizeTask(totalTasks)}`
  if (matchCount === totalTasks) return `Showing all ${totalTasks} ${pluralizeTask(totalTasks)}`
  return `Showing ${matchCount} of ${totalTasks} ${pluralizeTask(totalTasks)}`
}

export function formatTaskFilterAriaLabel(label: string, active: boolean) {
  return `${active ? 'Disable' : 'Enable'} ${label.toLowerCase()} task filter`
}

export function formatTaskRefreshStatus(isFetching: boolean, isInitialLoading: boolean) {
  if (isInitialLoading) return 'Loading task board…'
  if (isFetching) return 'Updating task board…'
  return null
}

export function formatCompactTaskColumnAriaLabel(label: string, taskCount: number) {
  if (taskCount === 0) return `${label} column is empty. Add a task or drop one here.`
  return `${label} column with ${taskCount} ${pluralizeTask(taskCount)}`
}

export function formatCompactTaskColumnActionLabel(label: string) {
  return `Add a task to the ${label} column`
}

export function formatBlockedTaskBreakdownLabel(waitingForInput: number, executionFailures: number) {
  if (waitingForInput > 0 && executionFailures > 0) return `${waitingForInput} input · ${executionFailures} err`
  if (waitingForInput > 0) return 'needs input'
  if (executionFailures > 0) return 'exec error'
  return null
}

type ExecutableReviewCandidate = Pick<ClaudeTask, 'column' | 'agent_history'> & { agent_state?: ClaudeTask['agent_state'] }

export function countExecutableReviewTasks(tasks: Array<ExecutableReviewCandidate>) {
  return tasks.filter((task) => {
    if (task.column !== 'review' || task.agent_state) return false
    const plannedHistory = (task.agent_history ?? []).filter((entry) => entry.action === 'planned')
    if (plannedHistory.length === 0) return false
    const lastNote = plannedHistory[plannedHistory.length - 1].note
    return !lastNote.includes('Plan unavailable') && lastNote.length >= 80
  }).length
}

export function formatBlockedTaskBreakdownTitle(waitingForInput: number, executionFailures: number) {
  return [
    waitingForInput > 0 ? `${waitingForInput} waiting for input` : '',
    executionFailures > 0 ? `${executionFailures} execution failure${executionFailures === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(', ')
}

export function formatTaskStatFilterButtonLabel(label: string, active: boolean) {
  return `${active ? 'Disable' : 'Enable'} ${label.toLowerCase()} task filter`
}
