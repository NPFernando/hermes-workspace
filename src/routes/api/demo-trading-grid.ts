/**
 * Paper-mode grid trading API — fully separate from /api/demo-trading (the
 * council/guardian engine). No real orders, no API keys; reads public
 * market data only. See src/server/grid-paper-engine.ts for why this is an
 * independent module rather than an extension of the council engine.
 *
 *  GET  /api/demo-trading-grid            → grid state + recent trades
 *  POST /api/demo-trading-grid {action}   → "run_cycle" advances the grid
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'
import {
  getGridEngineState,
  runGridPaperCycle,
} from '../../server/grid-paper-engine'

export const Route = createFileRoute('/api/demo-trading-grid')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return json({ ok: true, ...getGridEngineState() })
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
          const result = await runGridPaperCycle()
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
