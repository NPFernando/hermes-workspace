/**
 * Auto-refinement API — generic risk-reducing-only parameter tuning across
 * the grid, rebalance, and LLM-signal engines. See
 * src/server/auto-refinement.ts for the evidence thresholds and the
 * off-by-default policy gate. This route never itself decides to enable
 * live application — `settings.autoRefinement.enabled` is toggled via
 * set_demo_config on /api/finance, same as every other engine knob.
 *
 *  GET  /api/auto-refinement            → policy + dry-run candidate preview
 *  POST /api/auto-refinement {action}   → "run_cycle" evaluates + (if enabled) applies
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  getAutoRefinementState,
  runAutoRefinementCycle,
} from '../../server/auto-refinement'
import {
  requireJsonContentType,
  safeErrorMessage,
} from '../../server/rate-limit'

export const Route = createFileRoute('/api/auto-refinement')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        try {
          return json({ ok: true, ...getAutoRefinementState() })
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
          const result = await runAutoRefinementCycle()
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
