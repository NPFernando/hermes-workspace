/**
 * Legacy-compatible Binance trading engine API.
 *
 * The route name remains `/api/demo-trading` for compatibility. The engine
 * itself supports the staged paper -> sandbox/testnet -> gated live lifecycle.
 *
 *  GET  /api/demo-trading            → engine state (scores + open positions)
 *  POST /api/demo-trading {action}   → "run_cycle" triggers one trading cycle
 *
 * Execution can run in paper, Binance testnet, or gated Binance live mode. The POST
 * "run_cycle" honours finance trading gates; force never bypasses live safety.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getClientIp,
  rateLimit,
  rateLimitResponse,
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'
import {
  decisionQualityReport,
  getEngineState,
  getLastTradingCycleDiagnostics,
  getLiveMonitor,
  getStrategyEligibilityAudit,
  marketLearningReport,
  runTradingCycle,
} from '../../server/demo-trading-engine'

export const Route = createFileRoute('/api/demo-trading')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          const monitor = await getLiveMonitor()
          return json({
            ok: true,
            ...getEngineState(monitor),
            monitor,
            strategyEligibilityAudit: getStrategyEligibilityAudit(),
            lastCycleDiagnostics: getLastTradingCycleDiagnostics(),
            learning: decisionQualityReport(),
            marketLearning: marketLearningReport(),
          })
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
        if (
          !rateLimit(`demo-trading:post:${getClientIp(request)}`, 6, 60_000)
        ) {
          return rateLimitResponse()
        }
        try {
          const body = (await request.json().catch(() => ({}))) as {
            action?: string
            force?: boolean
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
          const result = await runTradingCycle({
            force: body.force === true,
          })
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
