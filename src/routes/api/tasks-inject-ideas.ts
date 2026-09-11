import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  injectIdeasAsBacklog,
  runAgentDeployBackground,
} from '../../server/astra-tasks'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '../../server/rate-limit'

export const Route = createFileRoute('/api/tasks-inject-ideas')({
  server: {
    handlers: {
      POST: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        if (!rateLimit(`tasks-inject-ideas:${getClientIp(request)}`, 5, 60_000)) {
          return rateLimitResponse()
        }
        const result = injectIdeasAsBacklog()
        // Auto-start the review pipeline for the first injected task.
        // The self-chain in the script handles subsequent tasks one by one.
        if (result.injected > 0) runAgentDeployBackground()
        return json({ ok: true, ...result })
      },
    },
  },
})
