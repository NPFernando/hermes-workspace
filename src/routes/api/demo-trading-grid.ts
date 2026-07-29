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
import { appendAuditLog, readFinanceStore } from '../../server/finance-store'
import { DEFAULT_GUARDIAN_CONFIG, bucketExposureQuote } from '../../server/trading-guardian'
import { crossEngineBucketExposureQuote } from '../../server/exposure-aggregator'
import { getEngineState } from '../../server/demo-trading-engine'

/**
 * Grid-side half of cross-engine correlated-exposure awareness (council's
 * half landed in exposure-aggregator.ts / demo-trading-engine.ts, PR #24 —
 * see that PR's "KNOWN GAP" note: grid's own entry logic had zero
 * awareness of council's exposure). grid-paper-engine.ts stays isolated
 * from demo-trading-engine.ts/trading-guardian.ts by design (its own
 * module doc), and exposure-aggregator.ts already imports FROM
 * grid-paper-engine.ts — so neither of those can also import from
 * demo-trading-engine.ts without a circular import (demo-trading-engine.ts
 * already imports FROM exposure-aggregator.ts). This route layer is the
 * one place that can safely import from all three without creating a
 * cycle, so the check lives here instead: after each grid cycle, compute
 * the same merged (council + grid) bucket exposure the council's own
 * guardian check already uses, and audit-log (not block — grid's
 * per-candle batch replay doesn't map cleanly onto a hard block the way
 * a single discrete council order proposal does) when it's over cap.
 */
export function warnIfCrossEngineExposureBreached(): void {
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const guardianOverride =
    (settings.demoTrading as Record<string, unknown> | undefined)?.guardian
  const guardian = {
    ...DEFAULT_GUARDIAN_CONFIG,
    ...(guardianOverride && typeof guardianOverride === 'object' ? guardianOverride : {}),
  }
  if (!guardian.correlationBucketsEnabled) return
  const councilExposure = bucketExposureQuote(
    getEngineState().positions,
    guardian.correlationBuckets,
  )
  const merged = crossEngineBucketExposureQuote(councilExposure, guardian.correlationBuckets)
  for (const [bucket, exposureQuote] of Object.entries(merged)) {
    if (exposureQuote > guardian.maxBucketExposureQuote) {
      appendAuditLog('grid_cross_engine_exposure_warning', {
        bucket,
        exposureQuote,
        cap: guardian.maxBucketExposureQuote,
        symbols: guardian.correlationBuckets[bucket] ?? [],
      })
    }
  }
}

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
          if (result.ran) {
            try {
              warnIfCrossEngineExposureBreached()
            } catch {
              // Best-effort audit visibility only — never let this check's
              // failure mask a real grid cycle result.
            }
          }
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
