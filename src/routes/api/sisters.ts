import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { bootstrapOnceLazy, listSisters } from '../../server/sisters-registry'

export const Route = createFileRoute('/api/sisters')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        // Lazily ensure profiles exist on first call
        bootstrapOnceLazy()
        try {
          const sisters = listSisters()
          return json({ ok: true, sisters })
        } catch (err) {
          return json(
            { ok: false, error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          )
        }
      },
    },
  },
})
