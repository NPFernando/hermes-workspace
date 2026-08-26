import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { getTradingSummary } from '@/server/trading-summary'

export const Route = createFileRoute('/api/trading/summary')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        return json({ ok: true, summary: getTradingSummary() })
      },
    },
  },
})
