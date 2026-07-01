import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'
import { gatewayFetch } from '../../server/gateway-capabilities'

export const Route = createFileRoute('/api/model-switch')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrfCheck = requireJsonContentType(request)
        if (csrfCheck) return csrfCheck

        try {
          const body = (await request.json()) as { sessionKey?: string; model?: string }
          if (!body.model) {
            return json({ ok: false, error: 'model is required' }, { status: 400 })
          }

          // Forward to gateway if it supports model-switch; fall back to ok:true
          const res = await gatewayFetch('/api/model-switch', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })

          if (res.status === 404) {
            // Gateway doesn't support model-switch yet — acknowledge silently
            return json({ ok: true, switched: false })
          }

          const payload = await res.json().catch(() => ({ ok: true }))
          return json(payload, { status: res.ok ? 200 : res.status })
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
