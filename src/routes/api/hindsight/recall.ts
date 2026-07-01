import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { recallHindsight } from '../../../server/hindsight-client'

import { safeErrorMessage } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/hindsight/recall')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const body = (await request.json()) as { query?: string; budget?: string; bank?: string }
          const query = String(body.query ?? '').trim()
          if (!query) {
            return json({ error: 'query is required' }, { status: 400 })
          }
          const budget = String(body.budget ?? 'mid')
          const bank = body.bank ? String(body.bank) : undefined
          return json(await recallHindsight(query, budget, bank))
        } catch (err) {
          return json(
            { error: safeErrorMessage(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
