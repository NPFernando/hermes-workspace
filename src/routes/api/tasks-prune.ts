import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { deleteTask, listTasks } from '../../server/tasks-store'

import { safeErrorMessage } from '../../server/rate-limit'
// POST /api/tasks-prune — delete todo/backlog tasks that:
//   - have no agent history (never processed)
//   - are older than 2 hours
//   - source is 'astra' or 'idea_job' (auto-generated, safe to prune)
export const Route = createFileRoute('/api/tasks-prune')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const TWO_HOURS_MS = 2 * 60 * 60 * 1000
          const now = Date.now()

          const candidates = [
            ...listTasks({ column: 'todo' }),
            ...listTasks({ column: 'backlog' }),
          ].filter((t) => {
            if ((t.agent_history ?? []).length > 0) return false
            if (t.source === 'human') return false
            if (t.agent_state) return false
            const age = now - new Date(t.created_at).getTime()
            return age > TWO_HOURS_MS
          })

          let pruned = 0
          for (const t of candidates) {
            if (deleteTask(t.id)) pruned++
          }

          return json({ ok: true, pruned })
        } catch (err) {
          const msg = safeErrorMessage(err)
          return json({ ok: false, pruned: 0, error: msg }, { status: 500 })
        }
      },
    },
  },
})
