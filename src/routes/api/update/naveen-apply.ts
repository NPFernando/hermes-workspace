import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
  safeErrorMessage,
} from '../../../server/rate-limit'
import {  applyNaveenSmartUpdate } from '../../../server/naveen-update'
import type {NaveenApplyOptions} from '../../../server/naveen-update';

export const Route = createFileRoute('/api/update/naveen-apply')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`naveen-apply:${getClientIp(request)}`, 3, 60_000)) {
          return rateLimitResponse()
        }
        try {
          const body = (await request.json().catch(() => ({}))) as NaveenApplyOptions
          const result = applyNaveenSmartUpdate(body)
          return json(result, { status: result.ok ? 200 : 409 })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
