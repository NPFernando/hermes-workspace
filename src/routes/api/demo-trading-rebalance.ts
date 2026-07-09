/**
 * Rebalancing-bot API — fully separate from /api/demo-trading (council) and
 * /api/demo-trading-grid. Executes real signed testnet orders (not paper) —
 * see src/server/rebalance-engine.ts for the isolation rationale.
 *
 *  GET  /api/demo-trading-rebalance            → state + recent trades
 *  POST /api/demo-trading-rebalance {action}   → "run_cycle" advances it
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'
import {
  getRebalanceState,
  runRebalanceCycle,
} from '../../server/rebalance-engine'

export const Route = createFileRoute('/api/demo-trading-rebalance')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return json({ ok: true, ...getRebalanceState() })
        } catch (err) {
          return json(
            { ok: false, error: safeErrorMessage(err) },
            { status: 500 },
          )
        }
      },
      POST: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const csrf = requireJsonContentType(request)
        if (csrf) return csrf
        try {
          const body = (await request.json().catch(() => ({}))) as {
            action?: string
          }
          if (body.action !== 'run_cycle') {
            return json(
              {
                ok: false,
                error: 'Unknown action. Use { action: "run_cycle" }.',
              },
              { status: 400 },
            )
          }
          const result = await runRebalanceCycle()
          return json({ ok: true, result })
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
