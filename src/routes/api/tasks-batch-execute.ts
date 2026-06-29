import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { batchExecuteBackground } from '../../server/astra-tasks'

// POST /api/tasks-batch-execute
// Body: { limit?: number; taskIds?: Array<string> }
// Fires executeTaskWithHermesBackground on up to `limit` review tasks that
// have real plans, staggered 300 ms apart.
export const Route = createFileRoute('/api/tasks-batch-execute')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        let body: { limit?: number; taskIds?: Array<string> } = {}
        try { body = (await request.json()) as typeof body } catch { /* empty body ok */ }
        const limit = typeof body.limit === 'number' && body.limit > 0
          ? Math.min(body.limit, 20)
          : 5
        const result = batchExecuteBackground(limit, body.taskIds)
        return json({ ok: true, ...result })
      },
    },
  },
})
