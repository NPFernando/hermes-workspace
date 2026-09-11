import { json } from '@tanstack/react-start'
import { createFileRoute } from '@tanstack/react-router'
import { isAuthenticated } from '../../server/auth-middleware'
import { startClaudeAgent } from '../../server/claude-agent'

import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  safeErrorMessage,
} from '../../server/rate-limit'

export const Route = createFileRoute('/api/start-claude')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          if (!isAuthenticated(request)) {
            return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
          }
          if (!rateLimit(`agent-start:${getClientIp(request)}`, 5, 60_000)) {
            return rateLimitResponse()
          }

          const result = await startClaudeAgent()
          return json(result, { status: result.ok ? 200 : 500 })
        } catch (err) {
          return json(
            {
              ok: false,
              error: safeErrorMessage(err),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
