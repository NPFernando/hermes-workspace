import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'
import { gatewayFetch } from '../../server/gateway-capabilities'

export const Route = createFileRoute('/api/agent-pause')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`agent-pause:${getClientIp(request)}`, 20, 60_000)) {
          return rateLimitResponse()
        }

        try {
          const body = await request.json()
          const res = await gatewayFetch('/api/agent-pause', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
          const payload = await res.json().catch(() => ({}))
          return json(payload, { status: res.status })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 502 },
          )
        }
      },
    },
  },
})
