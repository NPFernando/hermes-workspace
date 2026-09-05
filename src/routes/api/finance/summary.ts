import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '@/server/auth-middleware'
import { ensureFinanceStore, financeSummary } from '@/server/finance-store'

/**
 * Lightweight companion to GET /api/finance for callers that only need the
 * summary tile fields (e.g. the dashboard's FinanceOverviewCard, which polls
 * every 30s). The full /api/finance payload also runs storage self-heal
 * checks, budget/trading-performance aggregation, and decision-quality
 * reports on every call — none of which a summary tile needs.
 */
export const Route = createFileRoute('/api/finance/summary')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const db = ensureFinanceStore()
        return json({ ok: true, summary: financeSummary(db) })
      },
    },
  },
})
