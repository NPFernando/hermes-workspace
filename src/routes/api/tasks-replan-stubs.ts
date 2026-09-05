import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { listTasks, updateTask } from '../../server/tasks-store'

export function isStubReviewTask(task: {
  column: string
  agent_state?: string | null
  agent_history?: Array<{ action: string; note?: string }>
}): boolean {
  if (task.agent_state) return false
  const history = task.agent_history ?? []
  // Find the last planned action in history (assuming chronological order)
  let lastPlannedIndex = -1
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].action === 'planned') {
      lastPlannedIndex = i
      break
    }
  }
  // If no planned action found, not a stub
  if (lastPlannedIndex === -1) return false
  // If there are any actions after the last planned action, something happened after the plan -> not a stub
  if (lastPlannedIndex < history.length - 1) return false
  const note = history[lastPlannedIndex].note ?? ''
  return note.includes('Plan unavailable') || note.length < 80
}

// POST /api/tasks-replan-stubs
// Moves review tasks with stub plans (<80 chars or "Plan unavailable") back to todo
// so the deploy sweep re-plans them with a real plan.

export const Route = createFileRoute('/api/tasks-replan-stubs')({
  server: {
    handlers: {
      POST: async () => {
        const now = new Date().toISOString()
        const stubs = listTasks({ column: 'review' }).filter(isStubReviewTask)

        for (const t of stubs) {
          await updateTask(t.id, {
            column: 'todo',
            agent_history: [
              ...(t.agent_history ?? []),
              {
                id: randomUUID(),
                by: 'Astra',
                byEmoji: '✨',
                action: 'replan_requested',
                at: now,
                note: 'Moved back to todo — plan was a stub (< 80 chars). Will be re-planned on next deploy sweep.',
              },
            ],
          })
        }

        return json({
          ok: true,
          moved: stubs.length,
          titles: stubs.slice(0, 10).map((t) => t.title.slice(0, 60)),
        })
      },
    },
  },
})
