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
import {
  bootstrapAllSisters,
  ensureSisterProfile,
  getSisterById,
  invalidateSistersCache,
  listSisters
} from '../../server/sisters-registry'
import type {Sister} from '../../server/sisters-registry';

export const Route = createFileRoute('/api/sisters-bootstrap')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck
        if (!rateLimit(`sisters-bootstrap:${getClientIp(request)}`, 10, 60_000)) {
          return rateLimitResponse()
        }
        try {
          const body = (await request.json().catch(() => ({}))) as { id?: string }
          if (body.id) {
            // Bootstrap single sister
            const sister = getSisterById(body.id)
            if (!sister) {
              return json({ ok: false, error: `Sister '${body.id}' not found` }, { status: 404 })
            }
            ensureSisterProfile(sister)
            invalidateSistersCache()
            return json({ ok: true, bootstrapped: [body.id] })
          }
          // Bootstrap all
          bootstrapAllSisters()
          const after = listSisters(true)
          return json({ ok: true, bootstrapped: after.map((s: Sister) => s.id) })
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
