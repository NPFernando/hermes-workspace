import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getHarpObservabilityView } from '../../server/harp-observability'

export const Route = createFileRoute('/api/harp-observability')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json({ ok: true, ...getHarpObservabilityView() })
      },
    },
  },
})
