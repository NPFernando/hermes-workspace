import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { deleteProfile } from '../../../server/profiles-browser'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
  safeErrorMessage,
} from '../../../server/rate-limit'

export const Route = createFileRoute('/api/profiles/delete')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`profile-delete:${getClientIp(request)}`, 10, 60_000)) {
          return rateLimitResponse()
        }
        try {
          const body = (await request.json()) as { name?: string }
          deleteProfile(body.name || '')
          return json({ ok: true })
        } catch (error) {
          return json(
            {
              error: safeErrorMessage(error),
            },
            { status: 500 },
          )
        }
      },
    },
  },
})
