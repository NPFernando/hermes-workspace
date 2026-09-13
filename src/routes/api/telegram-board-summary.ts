import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { listTasks } from '../../server/tasks-store'
import type { TaskRecord } from '../../server/tasks-store'

export function summarizeTaskBoard(tasks: Array<TaskRecord>) {
  const running = tasks.filter((task) => task.agent_state === 'working').length

  const ready = tasks.filter((task) => {
    if (task.column !== 'review' || task.agent_state) return false
    const plannedHistory = (task.agent_history ?? []).filter(
      (entry) => entry.action === 'planned',
    )
    const latestPlan = plannedHistory.at(-1)
    if (!latestPlan) return false
    return (
      latestPlan.note.length >= 80 &&
      !latestPlan.note.includes('Plan unavailable')
    )
  }).length

  const blocked = tasks.filter((task) => task.column === 'blocked').length
  const dependencyWaiting = tasks.filter(
    (task) =>
      task.column === 'todo' &&
      Array.isArray(task.depends_on) &&
      task.depends_on.length > 0,
  ).length

  return { running, ready, blocked, dependencyWaiting }
}

export function handleTaskBoardSummary(request: Request) {
  if (!isAuthenticated(request)) {
    return json(
      { ok: false, error: 'Unauthorized' },
      {
        status: 401,
        headers: { 'Cache-Control': 'private, no-store' },
      },
    )
  }

  const summary = summarizeTaskBoard(listTasks({ includeDone: true }))
  return json(
    { ok: true, ...summary },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}

export const Route = createFileRoute('/api/telegram-board-summary')({
  server: {
    handlers: {
      GET: ({ request }) => handleTaskBoardSummary(request),
    },
  },
})
