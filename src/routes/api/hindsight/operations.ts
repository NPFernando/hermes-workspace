import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listHindsightOperations } from '../../../server/hindsight-client'

import { safeErrorMessage } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/hindsight/operations')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const url = new URL(request.url)
          const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10)
          return json(await listHindsightOperations(Number.isFinite(limit) ? limit : 20))
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
