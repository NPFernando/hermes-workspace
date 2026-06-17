import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { recallHindsight } from '../../../server/hindsight-client'

export const Route = createFileRoute('/api/hindsight/recall')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const body = (await request.json()) as { query?: string; budget?: string }
          const query = String(body.query ?? '').trim()
          if (!query) {
            return json({ error: 'query is required' }, { status: 400 })
          }
          const budget = String(body.budget ?? 'mid')
          return json(await recallHindsight(query, budget))
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : 'Recall failed' },
            { status: 500 },
          )
        }
      },
    },
  },
})
