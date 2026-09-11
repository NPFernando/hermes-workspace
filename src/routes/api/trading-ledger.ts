/**
 * Read-only, engine-neutral trading ledger.
 *
 * Normalizes every one of the four independent trading engines' (council
 * demo-trading, grid, LLM signal, rebalance) current holdings (open
 * positions) and complete history (closed/executed trades) into one flat
 * record shape, so a single paginated endpoint
 * (src/routes/api/trading/ledger.ts) can list, filter, sort, and CSV-export
 * "everything we've ever held or traded" without any engine-specific
 * knowledge leaking into the UI.
 *
 * Strictly read-only and additive: every accessor here only reads
 * already-computed engine state (via each engine's own
 * `getFull*History()`/`get*State()`/`getAll*Trades()` exports) — nothing in
 * this file ever calls a `run*Cycle()`, writes to the finance store, or can
 * enable live trading. It never mutates orders. See each engine module for
 * the actual order-execution logic and its own extensive safety gates.
 *
 * Per-engine normalization notes (each engine models "a trade" differently,
 * so this is where those differences get reconciled):
 *  - council / grid: round-trip records (one row per open-to-close cycle),
 *    long-only (no shorting anywhere in either engine) — `side` is always
 *    "BUY" (the entry direction); closed rows carry both entry and exit
 *    price/quote plus realized P&L.
 *  - llm / rebalance: order-level records (one row per individual signed
 *    order, side is BUY or SELL) since both place discrete testnet orders
 *    rather than tracking a paired entry/exit lot the same way. Their route
 *    module docs both note "Executes real signed testnet orders (not
 *    paper)" — hence a fixed `executionMode: 'testnet'` for their rows.
 */
import { getFullEngineHistory, getLiveMonitor } from './demo-trading-engine'
import { getAllGridTrades, getGridEngineState } from './grid-paper-engine'
import { getAllLlmTrades, getLlmSignalState } from './llm-signal-engine'
import { getAllRebalanceTrades } from './rebalance-engine'
import type { LiveMonitor } from './demo-trading-engine'

export type LedgerEngine = 'council' | 'grid' | 'llm' | 'rebalance'
export type LedgerStatus = 'open' | 'closed'
export type LedgerSide = 'BUY' | 'SELL'

export interface LedgerRecord {
  /** Globally unique across all engines/records: `${engine}:${sourceId}`. */
  id: string
  engine: LedgerEngine
  status: LedgerStatus
  symbol: string
  /** Strategy/level/label attribution; null when the engine has none. */
  strategy: string | null
  /** 'paper' | 'testnet' | 'testnet_execute' | 'live' depending on engine —
   * intentionally left as a plain string rather than a shared enum since
   * each engine's execution-mode vocabulary already differs upstream. */
  executionMode: string | null
  side: LedgerSide | null
  openedAt: string | null
  closedAt: string | null
  /** Sort/filter key: `closedAt` when present, else `openedAt`. Always an
   * ISO 8601 string so lexical and chronological ordering agree. */
  timestamp: string
  quantity: number | null
  entryPrice: number | null
  exitPrice: number | null
  entryQuote: number | null
  exitQuote: number | null
  feesQuote: number | null
  /** Realized P&L, only ever present on `status: 'closed'` records where the
   * underlying engine tracks per-trade P&L (council, grid, some llm rows). */
  realizedPnlQuote: number | null
  /** Mark-to-market P&L, only ever present on `status: 'open'` council
   * records when a `LiveMonitor` was supplied (see `buildLedgerRecords`). */
  unrealizedPnlQuote: number | null
  /** The underlying engine's own record id, unprefixed. */
  sourceId: string
}

function councilRecords(monitor?: LiveMonitor): Array<LedgerRecord> {
  const history = getFullEngineHistory(monitor)
  const records: Array<LedgerRecord> = []
  for (const pos of [...history.positions, ...history.archivedPositions]) {
    records.push({
      id: `council:${pos.id}`,
      engine: 'council',
      status: 'open',
      symbol: pos.symbol,
      strategy: pos.strategyId,
      executionMode: pos.executionMode ?? 'testnet',
      side: 'BUY',
      openedAt: pos.openedAt,
      closedAt: null,
      timestamp: pos.openedAt,
      quantity: pos.quantity,
      entryPrice: pos.entryPrice,
      exitPrice: null,
      entryQuote: pos.entryQuote,
      exitQuote: null,
      feesQuote: pos.entryFeeQuote,
      realizedPnlQuote: null,
      unrealizedPnlQuote: pos.unrealizedPnlQuote ?? null,
      sourceId: pos.id,
    })
  }
  for (const trade of [...history.trades, ...history.archivedTrades]) {
    records.push({
      id: `council:${trade.id}`,
      engine: 'council',
      status: 'closed',
      symbol: trade.symbol,
      strategy: trade.strategyId,
      executionMode: trade.executionMode ?? 'testnet',
      side: 'BUY',
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      timestamp: trade.closedAt,
      quantity: trade.quantity,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      entryQuote: trade.entryQuote,
      exitQuote: trade.exitQuote,
      feesQuote: trade.feesQuote,
      realizedPnlQuote: trade.pnlQuote,
      unrealizedPnlQuote: null,
      sourceId: trade.id,
    })
  }
  return records
}

function gridRecords(): Array<LedgerRecord> {
  const { states, config } = getGridEngineState()
  const executionMode = config.executionMode
  const records: Array<LedgerRecord> = []
  for (const state of states) {
    state.levels.forEach((level, index) => {
      if (!level.held) return
      const quantity =
        level.entryPrice > 0 ? level.entryQuote / level.entryPrice : null
      records.push({
        id: `grid:${state.symbol}:${index}:${level.openedAt}`,
        engine: 'grid',
        status: 'open',
        symbol: state.symbol,
        strategy: `grid-level-${index}`,
        executionMode,
        side: 'BUY',
        openedAt: level.openedAt,
        closedAt: null,
        timestamp: level.openedAt,
        quantity,
        entryPrice: level.entryPrice,
        exitPrice: null,
        entryQuote: level.entryQuote,
        exitQuote: null,
        feesQuote: level.entryFeeQuote,
        realizedPnlQuote: null,
        // Grid doesn't expose a live mark price the same way council does
        // (see AccountOverview's own comment on this) — left unpopulated
        // rather than guessed.
        unrealizedPnlQuote: null,
        sourceId: `${state.symbol}:${index}`,
      })
    })
  }
  for (const trade of getAllGridTrades()) {
    records.push({
      id: `grid:${trade.id}`,
      engine: 'grid',
      status: 'closed',
      symbol: trade.symbol,
      strategy: `grid-level-${trade.levelIndex}`,
      executionMode,
      side: 'BUY',
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      timestamp: trade.closedAt,
      quantity: trade.quantity,
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      entryQuote: trade.entryQuote,
      exitQuote: trade.exitQuote,
      feesQuote: trade.feesQuote,
      realizedPnlQuote: trade.pnlQuote,
      unrealizedPnlQuote: null,
      sourceId: trade.id,
    })
  }
  return records
}

/** LLM signal engine always executes on the Binance testnet — see the
 * module doc on src/server/llm-signal-engine.ts and its route. */
const LLM_EXECUTION_MODE = 'testnet'
/** Rebalance engine likewise always executes on the Binance testnet — see
 * the module doc on src/server/rebalance-engine.ts and its route. */
const REBALANCE_EXECUTION_MODE = 'testnet'

function llmRecords(): Array<LedgerRecord> {
  const { positions } = getLlmSignalState()
  const records: Array<LedgerRecord> = []
  for (const pos of positions) {
    records.push({
      id: `llm:${pos.id}`,
      engine: 'llm',
      status: 'open',
      symbol: pos.symbol,
      strategy: 'llm-signal',
      executionMode: LLM_EXECUTION_MODE,
      side: 'BUY',
      openedAt: pos.openedAt,
      closedAt: null,
      timestamp: pos.openedAt,
      quantity: pos.quantity,
      entryPrice: pos.entryPrice,
      exitPrice: null,
      entryQuote: pos.entryQuote,
      exitQuote: null,
      feesQuote: null,
      realizedPnlQuote: null,
      unrealizedPnlQuote: null,
      sourceId: pos.id,
    })
  }
  for (const trade of getAllLlmTrades()) {
    const isBuy = trade.side === 'BUY'
    records.push({
      id: `llm:${trade.id}`,
      engine: 'llm',
      status: 'closed',
      symbol: trade.symbol,
      strategy: 'llm-signal',
      executionMode: LLM_EXECUTION_MODE,
      side: trade.side,
      openedAt: null,
      closedAt: trade.createdAt,
      timestamp: trade.createdAt,
      quantity: trade.quantity,
      entryPrice: isBuy ? trade.price : null,
      exitPrice: isBuy ? null : trade.price,
      entryQuote: isBuy ? trade.notionalQuote : null,
      exitQuote: isBuy ? null : trade.notionalQuote,
      feesQuote: null,
      realizedPnlQuote: trade.pnlQuote ?? null,
      unrealizedPnlQuote: null,
      sourceId: trade.id,
    })
  }
  return records
}

function rebalanceRecords(): Array<LedgerRecord> {
  return getAllRebalanceTrades().map((trade) => {
    const isBuy = trade.side === 'BUY'
    return {
      id: `rebalance:${trade.id}`,
      engine: 'rebalance',
      status: 'closed',
      symbol: trade.symbol,
      strategy: 'rebalance',
      executionMode: REBALANCE_EXECUTION_MODE,
      side: trade.side,
      openedAt: null,
      closedAt: trade.createdAt,
      timestamp: trade.createdAt,
      quantity: trade.quantity,
      entryPrice: isBuy ? trade.price : null,
      exitPrice: isBuy ? null : trade.price,
      entryQuote: isBuy ? trade.notionalQuote : null,
      exitQuote: isBuy ? null : trade.notionalQuote,
      feesQuote: null,
      // Rebalancing shuffles existing spot holdings rather than closing a
      // tracked lot, so it has no per-trade realized P&L concept (same
      // rationale as trading-summary.ts's TradingEngineStatus for
      // rebalance).
      realizedPnlQuote: null,
      unrealizedPnlQuote: null,
      sourceId: trade.id,
    }
  })
}

/** Builds the full, unfiltered, unpaginated ledger across all four engines.
 * Pass `monitor` (e.g. from `getLiveMonitor()`) to additionally populate
 * council open positions' `unrealizedPnlQuote`; omit it when that field
 * isn't needed to skip the (cached, ~20s-refreshed) network-derived lookup. */
export function buildLedgerRecords(monitor?: LiveMonitor): Array<LedgerRecord> {
  return [
    ...councilRecords(monitor),
    ...gridRecords(),
    ...llmRecords(),
    ...rebalanceRecords(),
  ]
}

/** Convenience wrapper that fetches the (cached) live monitor itself before
 * building the ledger, for callers that always want unrealized P&L. */
export async function buildLedgerRecordsWithMonitor(): Promise<
  Array<LedgerRecord>
> {
  const monitor = await getLiveMonitor()
  return buildLedgerRecords(monitor)
}

export interface LedgerFilters {
  engine?: LedgerEngine
  status?: LedgerStatus
  symbol?: string
  strategy?: string
  executionMode?: string
  side?: LedgerSide
  /** Inclusive lower bound on `timestamp`. Bare `YYYY-MM-DD` dates are
   * normalized to the start of that day (UTC). */
  from?: string
  /** Inclusive upper bound on `timestamp`. Bare `YYYY-MM-DD` dates are
   * normalized to the end of that day (UTC). */
  to?: string
}

export type LedgerSort = 'timestamp_desc' | 'timestamp_asc'

export interface LedgerQueryOptions extends LedgerFilters {
  page?: number
  pageSize?: number
  /** Defaults to 'timestamp_desc' (most recent activity first). Sorting
   * happens before pagination, so pages remain a contiguous, correctly
   * ordered window regardless of direction. */
  sort?: LedgerSort
}

export const LEDGER_DEFAULT_PAGE_SIZE = 50
export const LEDGER_MAX_PAGE_SIZE = 500
export const LEDGER_MAX_PAGE = 100_000

const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function normalizeDateBound(
  value: string | undefined,
  edge: 'start' | 'end',
): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (BARE_DATE_RE.test(trimmed)) {
    return edge === 'start'
      ? `${trimmed}T00:00:00.000Z`
      : `${trimmed}T23:59:59.999Z`
  }
  return trimmed
}

/** Clamps to a positive integer within [1, LEDGER_MAX_PAGE_SIZE], defaulting
 * to LEDGER_DEFAULT_PAGE_SIZE for anything missing/invalid — this is the
 * "bounded pageSize" guarantee the ledger endpoint promises. */
export function clampPageSize(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return LEDGER_DEFAULT_PAGE_SIZE
  return Math.min(LEDGER_MAX_PAGE_SIZE, Math.max(1, Math.floor(n)))
}

/** Clamps to a positive integer within [1, LEDGER_MAX_PAGE] — the "bounded
 * page" guarantee. A very large out-of-range page simply yields an empty
 * page rather than an error. */
export function clampPage(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(LEDGER_MAX_PAGE, Math.max(1, Math.floor(n)))
}

function matchesFilters(
  record: LedgerRecord,
  filters: LedgerFilters,
  fromBound: string | undefined,
  toBound: string | undefined,
  skipEngine: boolean,
): boolean {
  if (!skipEngine && filters.engine && record.engine !== filters.engine)
    return false
  if (filters.status && record.status !== filters.status) return false
  if (
    filters.symbol &&
    record.symbol.toUpperCase() !== filters.symbol.trim().toUpperCase()
  )
    return false
  if (
    filters.strategy &&
    (record.strategy ?? '').toLowerCase() !==
      filters.strategy.trim().toLowerCase()
  )
    return false
  if (
    filters.executionMode &&
    (record.executionMode ?? '') !== filters.executionMode.trim()
  )
    return false
  if (filters.side && record.side !== filters.side) return false
  if (fromBound && record.timestamp < fromBound) return false
  if (toBound && record.timestamp > toBound) return false
  return true
}

/** Descending by timestamp (most recent activity first) by default; ties
 * broken by id ascending so pagination stays stable/deterministic across
 * requests even when many records share the same timestamp. */
function compareRecords(
  a: LedgerRecord,
  b: LedgerRecord,
  sort: LedgerSort,
): number {
  if (a.timestamp !== b.timestamp) {
    const desc = a.timestamp < b.timestamp ? 1 : -1
    return sort === 'timestamp_asc' ? -desc : desc
  }
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

export interface LedgerQueryResult {
  records: Array<LedgerRecord>
  total: number
  page: number
  pageSize: number
  hasMore: boolean
  asOf: string
  counts: Record<LedgerEngine, number>
}

const EMPTY_COUNTS: Record<LedgerEngine, number> = {
  council: 0,
  grid: 0,
  llm: 0,
  rebalance: 0,
}

/** Filters, sorts (stable — see `compareRecords`), and paginates an
 * already-built record set. Never mutates `all`. `asOf` should be an ISO
 * timestamp describing when the underlying data was assembled (e.g.
 * `new Date().toISOString()`, or a live monitor's `asOfMs` when available). */
export function queryLedger(
  all: Array<LedgerRecord>,
  options: LedgerQueryOptions,
  asOf: string,
): LedgerQueryResult {
  const page = clampPage(options.page)
  const pageSize = clampPageSize(options.pageSize)
  const sort: LedgerSort = options.sort === 'timestamp_asc' ? 'timestamp_asc' : 'timestamp_desc'
  const fromBound = normalizeDateBound(options.from, 'start')
  const toBound = normalizeDateBound(options.to, 'end')

  const filtered = all.filter((r) =>
    matchesFilters(r, options, fromBound, toBound, false),
  )
  const sorted = filtered.slice().sort((a, b) => compareRecords(a, b, sort))
  const total = sorted.length
  const start = (page - 1) * pageSize
  const records = sorted.slice(start, start + pageSize)
  const hasMore = start + records.length < total

  // Per-engine counts ignore the `engine` filter itself (but respect every
  // other filter) so the UI can show "N council · N grid · N llm · N
  // rebalance" breakdowns regardless of which engine tab is selected.
  const counts: Record<LedgerEngine, number> = { ...EMPTY_COUNTS }
  for (const r of all) {
    if (matchesFilters(r, options, fromBound, toBound, true)) {
      counts[r.engine] += 1
    }
  }

  return { records, total, page, pageSize, hasMore, asOf, counts }
}

const CSV_COLUMNS: Array<keyof LedgerRecord> = [
  'id',
  'engine',
  'status',
  'symbol',
  'strategy',
  'executionMode',
  'side',
  'openedAt',
  'closedAt',
  'quantity',
  'entryPrice',
  'exitPrice',
  'entryQuote',
  'exitQuote',
  'feesQuote',
  'realizedPnlQuote',
  'unrealizedPnlQuote',
  'sourceId',
]

/** Escapes a single CSV field per RFC 4180: wraps in quotes (doubling any
 * embedded quotes) whenever the value contains a comma, quote, or newline —
 * the same rule the client-side `csvValue()` helper in trading-screen.tsx
 * already uses, mirrored here for the server-generated export. */
function csvEscape(value: string | number | boolean | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Renders a bounded set of ledger records (callers must have already
 * paginated — this never re-paginates or re-queries) as RFC-4180-ish CSV
 * text, safely escaped. */
export function renderLedgerCsv(records: Array<LedgerRecord>): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const record of records) {
    lines.push(
      CSV_COLUMNS.map((col) => csvEscape(record[col] as never)).join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}
