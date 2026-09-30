import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { clampDays, loadHarpRouteStats } from '../../server/harp-route-stats'

export const Route = createFileRoute('/api/harp-route-stats')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const days = clampDays(new URL(request.url).searchParams.get('days'))
        try {
          const stats = await loadHarpRouteStats(days)
          return json({ ok: true, ...stats })
        } catch {
          return json(
            { ok: false, error: 'HARP route stats are unavailable' },
            { status: 503 },
          )
        }
      },
    },
  },
})
