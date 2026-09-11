import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { runAstraReviewBackground } from '../../server/astra-tasks'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '../../server/rate-limit'

export const Route = createFileRoute('/api/tasks-astra-review')({
  server: {
    handlers: {
      POST: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        if (!rateLimit(`tasks-astra-review:${getClientIp(request)}`, 5, 60_000)) {
          return rateLimitResponse()
        }
        const result = runAstraReviewBackground()
        return json({ ok: true, ...result })
      },
    },
  },
})
