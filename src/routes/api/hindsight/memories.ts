import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { listHindsightMemories } from '../../../server/hindsight-client'

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
          return json(
            await listHindsightMemories({
              q,
              limit: Number.isFinite(limit) ? limit : 50,
              offset: Number.isFinite(offset) ? offset : 0,
            }),
          )
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : 'Failed to list memories' },
            { status: 500 },
          )
        }
      },
    },
  },
})
