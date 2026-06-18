import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  getDlqCount,
  getHindsightConfig,
  getHindsightHealth,
  getHindsightStats,
} from '../../../server/hindsight-client'

export const Route = createFileRoute('/api/hindsight/status')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }

        const config = getHindsightConfig()
        const dlqCount = getDlqCount()

        const [healthResult, statsResult] = await Promise.allSettled([
          getHindsightHealth(),
          getHindsightStats(),
        ])

        const daemon =
          healthResult.status === 'fulfilled'
            ? healthResult.value
            : { status: 'unreachable', database: 'disconnected' }

        const stats =
          statsResult.status === 'fulfilled' ? statsResult.value : null

        return json({
          daemon,
          model: String(config.llm_model ?? ''),
          provider: String(config.llm_provider ?? ''),
          dlqCount,
          stats,
        })
      },
    },
  },
})
