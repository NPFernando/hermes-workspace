import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { generateIdeasWithAI } from '../../server/astra-tasks'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
} from '../../server/rate-limit'

export const Route = createFileRoute('/api/tasks-generate-ideas')({
  server: {
    handlers: {
      POST: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        if (!rateLimit(`tasks-generate-ideas:${getClientIp(request)}`, 5, 60_000)) {
          return rateLimitResponse()
        }
        const result = generateIdeasWithAI()
        return json({ ok: result.injected > 0 || !result.error, ...result })
      },
    },
  },
})
