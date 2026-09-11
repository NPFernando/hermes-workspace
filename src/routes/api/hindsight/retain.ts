import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { retainHindsight } from '../../../server/hindsight-client'

import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
  safeErrorMessage,
} from '../../../server/rate-limit'

export const Route = createFileRoute('/api/hindsight/retain')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`hindsight-retain:${getClientIp(request)}`, 30, 60_000)) {
          return rateLimitResponse()
        }
        try {
          const body = (await request.json()) as {
            content?: string
            context?: string
            bank?: string
          }
          const content = String(body.content ?? '').trim()
          if (!content) {
            return json({ error: 'content is required' }, { status: 400 })
          }
          const bank = body.bank ? String(body.bank) : undefined
          return json(
            await retainHindsight(content, body.context?.trim(), bank),
          )
        } catch (err) {
          return json({ error: safeErrorMessage(err) }, { status: 500 })
        }
      },
    },
  },
})
