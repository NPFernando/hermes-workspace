import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { drainReadyReview } from '../../server/astra-tasks'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
} from '../../server/rate-limit'

// POST /api/tasks-drain-now
// Immediately queues all eligible review tasks (ignores the 45-min delay gate).
// Optional body: { limit?: number }  — defaults to 50

export const Route = createFileRoute('/api/tasks-drain-now')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`tasks-drain-now:${getClientIp(request)}`, 5, 60_000)) {
          return rateLimitResponse()
        }
        let body: { limit?: number } = {}
        try {
          body = (await request.json()) as typeof body
        } catch {
          /* empty body ok */
        }

        const { queued, titles } = drainReadyReview({
          ignoreDelay: true,
          limit: body.limit ?? 50,
        })

        return json({ ok: true, queued, titles })
      },

      // Draining queues work and is therefore deliberately POST-only. Keeping
      // a safe 405 response prevents browser prefetches or link navigation
      // from triggering execution as a side effect.
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return new Response(
          JSON.stringify({
            ok: false,
            error: 'Method Not Allowed: use POST to drain tasks',
          }),
          {
            status: 405,
            headers: {
              'Content-Type': 'application/json',
              Allow: 'POST',
            },
          },
        )
      },
    },
  },
})
