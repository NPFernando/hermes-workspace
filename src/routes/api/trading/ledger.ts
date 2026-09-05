/**
 * Read-only, authenticated, engine-neutral trading ledger — one paginated
 * view over every engine's current holdings (open positions) and complete
 * history (closed/executed trades). See src/server/trading-ledger.ts for
 * the per-engine normalization rules.
 *
 * Strictly additive and read-only: this route has no POST handler, never
 * calls any `run*Cycle()`, never writes to the finance store, and cannot
 * enable live trading. All four existing legacy routes (/api/demo-trading,
 * /api/demo-trading-grid, /api/demo-trading-llm, /api/demo-trading-rebalance)
 * are unchanged and remain the source of truth for engine control actions.
 *
 *  GET /api/trading/ledger
 *    ?engine=council|grid|llm|rebalance
 *    &status=open|closed
 *    &symbol=BTCUSDT
 *    &strategy=sma_crossover
 *    &executionMode=paper|testnet|testnet_execute|live
 *    &side=BUY|SELL
 *    &from=2026-01-01[T00:00:00.000Z]
 *    &to=2026-02-01[T00:00:00.000Z]
 *    &page=1              (default 1, clamped to a sane positive range)
 *    &pageSize=50          (default 50, max 500)
 *    &sort=timestamp_desc|timestamp_asc   (default timestamp_desc)
 *    &format=json|csv      (default json)
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../../server/auth-middleware'
import { safeErrorMessage } from '../../../server/rate-limit'
import {
  buildLedgerRecordsWithMonitor,
  queryLedger,
  renderLedgerCsv,
} from '../../../server/trading-ledger'
import type {
  LedgerEngine,
  LedgerQueryOptions,
  LedgerSide,
  LedgerStatus,
} from '../../../server/trading-ledger'

const VALID_ENGINES: ReadonlyArray<LedgerEngine> = [
  'council',
  'grid',
  'llm',
  'rebalance',
]
const VALID_STATUSES: ReadonlyArray<LedgerStatus> = ['open', 'closed']
const VALID_SIDES: ReadonlyArray<LedgerSide> = ['BUY', 'SELL']

function badRequest(error: string) {
  return json({ ok: false, error }, { status: 400 })
}

export const Route = createFileRoute('/api/trading/ledger')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const url = new URL(request.url)
        const params = url.searchParams

        const engineParam = params.get('engine')?.trim() || undefined
        if (engineParam && !VALID_ENGINES.includes(engineParam as LedgerEngine)) {
          return badRequest(
            `Invalid engine. Use one of: ${VALID_ENGINES.join(', ')}`,
          )
        }
        const statusParam = params.get('status')?.trim() || undefined
        if (statusParam && !VALID_STATUSES.includes(statusParam as LedgerStatus)) {
          return badRequest(
            `Invalid status. Use one of: ${VALID_STATUSES.join(', ')}`,
          )
        }
        const sideParam = params.get('side')?.trim().toUpperCase() || undefined
        if (sideParam && !VALID_SIDES.includes(sideParam as LedgerSide)) {
          return badRequest(`Invalid side. Use one of: ${VALID_SIDES.join(', ')}`)
        }
        const formatParam = (params.get('format')?.trim() || 'json').toLowerCase()
        if (formatParam !== 'json' && formatParam !== 'csv') {
          return badRequest('Invalid format. Use "json" or "csv".')
        }
        const sortParam = (params.get('sort')?.trim() || 'timestamp_desc').toLowerCase()
        if (sortParam !== 'timestamp_desc' && sortParam !== 'timestamp_asc') {
          return badRequest(
            'Invalid sort. Use "timestamp_desc" or "timestamp_asc".',
          )
        }

        const options: LedgerQueryOptions = {
          engine: engineParam as LedgerEngine | undefined,
          status: statusParam as LedgerStatus | undefined,
          symbol: params.get('symbol')?.trim() || undefined,
          strategy: params.get('strategy')?.trim() || undefined,
          executionMode: params.get('executionMode')?.trim() || undefined,
          side: sideParam as LedgerSide | undefined,
          from: params.get('from')?.trim() || undefined,
          to: params.get('to')?.trim() || undefined,
          page: params.has('page') ? Number(params.get('page')) : undefined,
          pageSize: params.has('pageSize')
            ? Number(params.get('pageSize'))
            : undefined,
          sort: sortParam,
        }

        try {
          const all = await buildLedgerRecordsWithMonitor()
          const asOf = new Date().toISOString()
          const result = queryLedger(all, options, asOf)

          if (formatParam === 'csv') {
            const csv = renderLedgerCsv(result.records)
            return new Response(csv, {
              status: 200,
              headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="trading-ledger-${asOf.slice(0, 10)}.csv"`,
              },
            })
          }

          return json({
            ok: true,
            records: result.records,
            total: result.total,
            page: result.page,
            pageSize: result.pageSize,
            hasMore: result.hasMore,
            asOf: result.asOf,
            counts: result.counts,
          })
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
