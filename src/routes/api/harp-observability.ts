import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getHarpObservabilityView } from '../../server/harp-observability'
import { getHarpReadiness } from '../../server/harp-memory-client'

export const Route = createFileRoute('/api/harp-observability')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const [observability, readiness] = await Promise.all([
          Promise.resolve(getHarpObservabilityView()),
          getHarpReadiness(),
        ])
        return json({ ok: true, ...observability, readiness })
      },
    },
  },
})
