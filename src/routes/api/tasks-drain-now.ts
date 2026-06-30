import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { drainReadyReview } from '../../server/astra-tasks'

// POST /api/tasks-drain-now
// Immediately queues all eligible review tasks (ignores the 45-min delay gate).
// Optional body: { limit?: number }  — defaults to 50

export const Route = createFileRoute('/api/tasks-drain-now')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { limit?: number } = {}
        try { body = (await request.json()) as typeof body } catch { /* empty body ok */ }

        const { queued, titles } = drainReadyReview({
          ignoreDelay: true,
          limit: body.limit ?? 50,
        })

        return json({ ok: true, queued, titles })
      },

      GET: () => {
        const { queued, titles } = drainReadyReview({ ignoreDelay: true, limit: 50 })
        return json({ ok: true, queued, titles })
      },
    },
  },
})
