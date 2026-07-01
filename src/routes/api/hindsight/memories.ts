import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listHindsightMemories } from '../../../server/hindsight-client'

import { safeErrorMessage } from '../../../server/rate-limit'

export const Route = createFileRoute('/api/hindsight/memories')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        try {
          const url = new URL(request.url)
          const q = url.searchParams.get('q') || undefined
          const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10)
          const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10)
          const bank = url.searchParams.get('bank') ?? undefined
          return json(
            await listHindsightMemories({
              q,
              limit: Number.isFinite(limit) ? limit : 50,
              offset: Number.isFinite(offset) ? offset : 0,
              bank,
            }),
          )
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
