import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getOpsObservability } from '../../server/ops-observability'
import { safeErrorMessage } from '../../server/rate-limit'

export const Route = createFileRoute('/api/ops-observability')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const payload = await getOpsObservability()
          return json({ ok: true, ...payload })
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
