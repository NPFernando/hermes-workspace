import { randomUUID } from 'node:crypto'
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { listTasks, updateTask } from '../../server/tasks-store'

// POST /api/tasks-replan-stubs
// Moves review tasks with stub plans (<80 chars or "Plan unavailable") back to todo
// so the deploy sweep re-plans them with a real plan.

export const Route = createFileRoute('/api/tasks-replan-stubs')({
  server: {
    handlers: {
      POST: async () => {
        const now = new Date().toISOString()
        const stubs = listTasks({ column: 'review' }).filter((t) => {
          if (t.agent_state) return false
          const planned = (t.agent_history ?? []).filter((h) => h.action === 'planned')
          if (planned.length === 0) return true
          const note = planned[planned.length - 1].note ?? ''
          return note.includes('Plan unavailable') || note.length < 80
        })

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

        return json({ ok: true, moved: stubs.length, titles: stubs.slice(0, 10).map((t) => t.title.slice(0, 60)) })
      },

      GET: async () => {
        const stubs = listTasks({ column: 'review' }).filter((t) => {
          if (t.agent_state) return false
          const planned = (t.agent_history ?? []).filter((h) => h.action === 'planned')
          if (planned.length === 0) return true
          const note = planned[planned.length - 1].note ?? ''
          return note.includes('Plan unavailable') || note.length < 80
        })
        return json({ ok: true, count: stubs.length })
      },
    },
  },
})
