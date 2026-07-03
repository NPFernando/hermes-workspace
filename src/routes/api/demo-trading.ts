/**
 * Demo trading engine API.
 *
 *  GET  /api/demo-trading            → engine state (scores + open positions)
 *  POST /api/demo-trading {action}   → "run_cycle" triggers one trading cycle
 *
 * All execution is demo-only (BinanceDemoClient is host-locked). The POST
 * "run_cycle" honours the finance tradingMode gate unless { force: true }.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { requireJsonContentType, safeErrorMessage } from '../../server/rate-limit'
import { getEngineState, runTradingCycle } from '../../server/demo-trading-engine'

export const Route = createFileRoute('/api/demo-trading')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return json({ ok: true, ...getEngineState() })
        } catch (err) {
          return json({ ok: false, error: safeErrorMessage(err) }, { status: 500 })
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
            force?: boolean
            config?: Record<string, unknown>
          }
          if (body.action !== 'run_cycle') {
            return json({ ok: false, error: 'Unknown action. Use { action: "run_cycle" }.' }, { status: 400 })
          }
          const result = await runTradingCycle({
            force: body.force === true,
            config: body.config as never,
          })
          return json({ ok: true, result })
        } catch (err) {
          return json({ ok: false, error: safeErrorMessage(err) }, { status: 500 })
        }
      },
    },
  },
})
