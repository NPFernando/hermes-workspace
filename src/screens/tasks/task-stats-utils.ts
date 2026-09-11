import { countExecutableReviewTasks } from './format-utils'
import type { ClaudeTask } from '@/lib/tasks-api'
import { isOverdue } from '@/lib/tasks-api'

export type GatedPrerequisiteSummary = {
  id: string
  count: number
  title: string
}

export type TodayTaskWin = {
  task: ClaudeTask
  completedAt: string
  note: string
}

export type TaskBoardStats = {
  total: number
  running: number
  blocked: number
  blockedWaiting: number
  blockedExecFail: number
  done: number
  overdue: number
  completion: number
  agentActive: number
  readyToExecute: number
  gatedPrereqs: Array<GatedPrerequisiteSummary>
  timedOut: number
  workingTasks: Array<ClaudeTask>
  stubReviewCount: number
  sisterChips: Array<[string, number]>
  todayWins: Array<TodayTaskWin>
  inboxTasks: Array<ClaudeTask>
  tagCloud: Record<string, number>
}

export function getTaskBoardStats(
  tasks: Array<ClaudeTask>,
  now = new Date(),
): TaskBoardStats {
  const total = tasks.length
  const running = tasks.filter((task) => task.column === 'in_progress').length
  const blockedTasks = tasks.filter((task) => task.column === 'blocked')
  const blocked = blockedTasks.length
  const blockedWaiting = blockedTasks.filter(
    (task) => task.waiting_for_user,
  ).length
  const blockedExecFail = blockedTasks.filter(
    (task) => !task.waiting_for_user,
  ).length
  const done = tasks.filter((task) => task.column === 'done').length
  const overdue = tasks.filter(
    (task) => isOverdue(task) && task.column !== 'done',
  ).length
  const completion = total > 0 ? Math.round((done / total) * 100) : 0
  const agentActive = tasks.filter((task) => task.agent_state).length
  const readyToExecute = countExecutableReviewTasks(tasks)

  const prereqGroups = new Map<string, { count: number; title: string }>()
  for (const task of tasks) {
    for (const dependencyId of task.depends_on ?? []) {
      const prereq = tasks.find((candidate) => candidate.id === dependencyId)
      const entry = prereqGroups.get(dependencyId)
      if (entry) entry.count++
      else {
        prereqGroups.set(dependencyId, {
          count: 1,
          title: prereq?.title ?? 'prerequisite',
        })
      }
    }
  }
  const gatedPrereqs = [...prereqGroups.entries()].map(
    ([id, { count, title }]) => ({ id, count, title }),
  )

  const timedOut = tasks.filter(
    (task) =>
      task.column !== 'done' &&
      (task.agent_history ?? []).some((entry) => entry.action === 'timed_out'),
  ).length
  const workingTasks = tasks.filter((task) => task.agent_state === 'working')
  const stubReviewCount = tasks.filter((task) => {
    if (task.column !== 'review' || task.agent_state) return false
    const planned = (task.agent_history ?? []).filter(
      (entry) => entry.action === 'planned',
    )
    if (planned.length === 0) return true
    const note = planned[planned.length - 1].note
    return note.includes('Plan unavailable') || note.length < 80
  }).length

  const sisterLoad: Record<string, number> = {}
  for (const task of tasks) {
    if (task.column !== 'done' && task.column !== 'deleted' && task.assignee) {
      sisterLoad[task.assignee] = (sisterLoad[task.assignee] ?? 0) + 1
    }
  }
  const sisterChips = Object.entries(sisterLoad)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  const today = now.toISOString().slice(0, 10)
  const todayWins: Array<TodayTaskWin> = []
  for (const task of tasks) {
    for (const entry of task.agent_history ?? []) {
      if (entry.action === 'completed' && entry.at.startsWith(today)) {
        todayWins.push({
          task,
          completedAt: entry.at,
          note: entry.note,
        })
      }
    }
  }
  todayWins.sort((a, b) => b.completedAt.localeCompare(a.completedAt))

  const inboxTasks = tasks.filter(
    (task) => task.waiting_for_user || task.column === 'blocked',
  )
  const tagCloud: Record<string, number> = {}
  for (const task of tasks) {
    if (task.column === 'done' || task.column === 'deleted') continue
    for (const tag of task.tags) tagCloud[tag] = (tagCloud[tag] ?? 0) + 1
  }

  return {
    total,
    running,
    blocked,
    blockedWaiting,
    blockedExecFail,
    done,
    overdue,
    completion,
    agentActive,
    readyToExecute,
    gatedPrereqs,
    timedOut,
    workingTasks,
    stubReviewCount,
    sisterChips,
    todayWins,
    inboxTasks,
    tagCloud,
  }
}
