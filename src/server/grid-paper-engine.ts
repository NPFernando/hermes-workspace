/**
 * Live paper-mode grid engine — the incremental, stateful counterpart to
 * src/server/grid-backtest.ts's offline batch replay. A live cycle can't
 * re-simulate from scratch every run (the range/levels would silently
 * reshuffle each time the fetch window moves), so this persists grid state
 * between cycles and only steps forward through genuinely new candles.
 *
 * Deliberately reimplements grid-backtest.ts's per-candle transition rules
 * rather than importing them — this repo already keeps its offline/live
 * pairs separate (trading-backtest.ts vs demo-trading-engine.ts don't share
 * a core either), and this module is intentionally isolated from
 * demo-trading-engine.ts entirely: its own lock, its own settings key
 * (`settings.demoTradingGrid`), its own finance-store kinds, zero shared
 * mutable state with the council engine's 5-minute cycle.
 *
 * Paper-only: reads public market data (fetchBinanceKlines), places no real
 * orders, needs no API keys. Config defaults match the blind-tested
 * candidate from the offline research (efficiency-ratio gate only — the
 * range-width chop gate was tested and found to hurt results when combined).
 */
import { randomUUID } from 'node:crypto'
import { fetchBinanceKlines } from './binance-market.service'
import { readFinanceStore, writeFinanceStore } from './finance-store'
import { isConnectivityBreakerTripped } from './connectivity-breaker'
import type { Candle } from './trading-strategies'

export type GridSpacing = 'arithmetic' | 'geometric'

export interface GridEngineConfig {
  symbols: Array<string>
  interval: string
  rangeLookbackCandles: number
  gridCount: number
  spacing: GridSpacing
  quotePerGrid: number
  feeRatePerSide: number
  upperStopPct: number
  lowerStopPct: number
  autoRecenter: boolean
  efficiencyGate: boolean
  efficiencyLookbackCandles: number
  maxEfficiencyRatio: number
  /** Trailing candles fetched per cycle; must exceed rangeLookback + efficiencyLookback. */
  fetchCandleLimit: number
}

export const DEFAULT_GRID_ENGINE_CONFIG: GridEngineConfig = {
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  interval: '1h',
  rangeLookbackCandles: 200,
  gridCount: 20,
  spacing: 'geometric',
  quotePerGrid: 5,
  feeRatePerSide: 0.001,
  upperStopPct: 0.3,
  lowerStopPct: 0.15,
  autoRecenter: true,
  efficiencyGate: true,
  efficiencyLookbackCandles: 100,
  maxEfficiencyRatio: 0.25,
  fetchCandleLimit: 500,
}

export function resolveGridEngineConfig(settingsOverride: unknown): GridEngineConfig {
  const fromSettings =
    settingsOverride && typeof settingsOverride === 'object'
      ? (settingsOverride as Partial<GridEngineConfig>)
      : {}
  return { ...DEFAULT_GRID_ENGINE_CONFIG, ...fromSettings }
}

const SR_KIND_GRID_STATE = 'demo_grid_state'
const SR_KIND_GRID_TRADE = 'demo_grid_trade'
const GRID_TRADE_LOG_CAP = 500

interface GridLevelState {
  price: number
  held: boolean
  entryPrice: number
  entryQuote: number
  entryFeeQuote: number
  openedAt: string
}

export interface GridSymbolState {
  kind: typeof SR_KIND_GRID_STATE
  symbol: string
  armed: boolean
  halted: boolean
  pausedForChop: boolean
  lower: number
  upper: number
  levels: Array<GridLevelState>
  lastProcessedOpenTime: number
  updatedAt: string
}

export interface GridPaperTrade {
  kind: typeof SR_KIND_GRID_TRADE
  id: string
  symbol: string
  levelIndex: number
  entryPrice: number
  exitPrice: number
  quantity: number
  entryQuote: number
  exitQuote: number
  pnlQuote: number
  feesQuote: number
  reason: 'grid-fill' | 'stop-liquidation' | 'chop-pause-liquidation'
  openedAt: string
  closedAt: string
}

// ── pure math helpers (mirrors grid-backtest.ts; reimplemented, not shared) ──

function buildLevels(
  lower: number,
  upper: number,
  spacing: GridSpacing,
  count: number,
): Array<number> {
  if (count < 2 || upper <= lower) return []
  const levels: Array<number> = []
  if (spacing === 'arithmetic') {
    const step = (upper - lower) / (count - 1)
    for (let i = 0; i < count; i++) levels.push(lower + step * i)
  } else {
    const ratio = Math.pow(upper / lower, 1 / (count - 1))
    for (let i = 0; i < count; i++) levels.push(lower * Math.pow(ratio, i))
  }
  return levels
}

function rangeFromWindow(
  candles: Array<Candle>,
  endIndexInclusive: number,
  lookback: number,
): { lower: number; upper: number } | null {
  const start = Math.max(0, endIndexInclusive - lookback + 1)
  if (endIndexInclusive - start + 1 < lookback) return null
  let lower = Infinity
  let upper = -Infinity
  for (let i = start; i <= endIndexInclusive; i++) {
    lower = Math.min(lower, candles[i].low)
    upper = Math.max(upper, candles[i].high)
  }
  return { lower, upper }
}

function efficiencyRatio(
  candles: Array<Candle>,
  endIndexInclusive: number,
  lookback: number,
): number | null {
  const startClose = endIndexInclusive - lookback
  if (startClose < 0) return null
  const netMove = Math.abs(candles[endIndexInclusive].close - candles[startClose].close)
  let pathLength = 0
  for (let i = startClose + 1; i <= endIndexInclusive; i++) {
    pathLength += Math.abs(candles[i].close - candles[i - 1].close)
  }
  if (pathLength <= 0) return null
  return netMove / pathLength
}

function initLevelStates(prices: Array<number>): Array<GridLevelState> {
  return prices.map((price) => ({
    price,
    held: false,
    entryPrice: 0,
    entryQuote: 0,
    entryFeeQuote: 0,
    openedAt: '',
  }))
}

function armFrom(
  candles: Array<Candle>,
  endIndex: number,
  config: GridEngineConfig,
): { lower: number; upper: number; levels: Array<GridLevelState> } | null {
  const range = rangeFromWindow(candles, endIndex, config.rangeLookbackCandles)
  if (!range) return null
  const levels = initLevelStates(buildLevels(range.lower, range.upper, config.spacing, config.gridCount))
  if (levels.length < 2) return null
  return { lower: range.lower, upper: range.upper, levels }
}

function liquidateAll(
  levels: Array<GridLevelState>,
  price: number,
  at: string,
  reason: GridPaperTrade['reason'],
  symbol: string,
  config: GridEngineConfig,
  trades: Array<GridPaperTrade>,
): void {
  levels.forEach((level, levelIndex) => {
    if (!level.held) return
    const quantity = level.entryQuote / level.entryPrice
    const exitQuote = quantity * price
    const exitFee = exitQuote * config.feeRatePerSide
    const feesQuote = level.entryFeeQuote + exitFee
    const pnlQuote = exitQuote - level.entryQuote - feesQuote
    trades.push({
      kind: SR_KIND_GRID_TRADE,
      id: randomUUID(),
      symbol,
      levelIndex,
      entryPrice: level.entryPrice,
      exitPrice: price,
      quantity,
      entryQuote: level.entryQuote,
      exitQuote,
      pnlQuote,
      feesQuote,
      reason,
      openedAt: level.openedAt,
      closedAt: at,
    })
    level.held = false
  })
}

/**
 * Steps a single symbol's persisted grid state forward through any candles
 * newer than `persisted.lastProcessedOpenTime`. Pure (no I/O) so it's
 * directly unit-testable and so two sequential calls over adjoining candle
 * slices are guaranteed to produce the same result as one call over the
 * combined slice — that equivalence is exactly what makes cron-restart-safe
 * incremental processing correct.
 */
export function advanceSymbolState(
  symbol: string,
  persisted: GridSymbolState | undefined,
  candles: Array<Candle>,
  config: GridEngineConfig,
): { state: GridSymbolState; trades: Array<GridPaperTrade> } {
  const trades: Array<GridPaperTrade> = []
  const now = new Date().toISOString()

  let armed = persisted?.armed ?? false
  let halted = persisted?.halted ?? false
  let pausedForChop = persisted?.pausedForChop ?? false
  let lower = persisted?.lower ?? 0
  let upper = persisted?.upper ?? 0
  let levels: Array<GridLevelState> = persisted?.levels
    ? persisted.levels.map((l) => ({ ...l }))
    : []
  let lastProcessedOpenTime = persisted?.lastProcessedOpenTime ?? 0

  let startIndex = candles.findIndex((c) => c.openTime > lastProcessedOpenTime)

  if (!persisted) {
    // Cold start: arm using the oldest available warmup window in this
    // fetch and skip that bar for fills — the bar that defines the range
    // would trivially "sweep" whichever boundary it just set.
    const warmupIndex = Math.min(config.rangeLookbackCandles - 1, candles.length - 1)
    const armResult = armFrom(candles, warmupIndex, config)
    if (armResult) {
      lower = armResult.lower
      upper = armResult.upper
      levels = armResult.levels
      armed = true
    }
    if (candles[warmupIndex]) lastProcessedOpenTime = candles[warmupIndex].openTime
    startIndex = warmupIndex + 1
  }

  if (startIndex < 0 || startIndex >= candles.length) {
    return {
      state: {
        kind: SR_KIND_GRID_STATE,
        symbol,
        armed,
        halted,
        pausedForChop,
        lower,
        upper,
        levels,
        lastProcessedOpenTime,
        updatedAt: now,
      },
      trades,
    }
  }

  for (let i = startIndex; i < candles.length; i++) {
    const candle = candles[i]
    const at = new Date(candle.openTime).toISOString()
    lastProcessedOpenTime = candle.openTime

    if (!armed) {
      if (!halted && i >= config.rangeLookbackCandles - 1) {
        const armResult = armFrom(candles, i, config)
        armed = !!armResult
        if (armResult) {
          lower = armResult.lower
          upper = armResult.upper
          levels = armResult.levels
        }
      }
      continue
    }

    const efficiency = config.efficiencyGate
      ? efficiencyRatio(candles, i, config.efficiencyLookbackCandles)
      : null
    const trending =
      config.efficiencyGate && efficiency != null && efficiency > config.maxEfficiencyRatio

    if (trending && !pausedForChop) {
      liquidateAll(levels, candle.close, at, 'chop-pause-liquidation', symbol, config, trades)
      pausedForChop = true
      continue
    } else if (!trending && pausedForChop) {
      pausedForChop = false
      const armResult = armFrom(candles, i, config)
      armed = !!armResult
      if (armResult) {
        lower = armResult.lower
        upper = armResult.upper
        levels = armResult.levels
      }
      continue
    }

    const upperBound = config.upperStopPct > 0 ? upper * (1 + config.upperStopPct) : null
    const lowerBound = config.lowerStopPct > 0 ? lower * (1 - config.lowerStopPct) : null
    const breachedUp = upperBound != null && candle.close > upperBound
    const breachedDown = lowerBound != null && candle.close < lowerBound
    if (breachedUp || breachedDown) {
      liquidateAll(levels, candle.close, at, 'stop-liquidation', symbol, config, trades)
      armed = false
      if (config.autoRecenter) {
        const armResult = armFrom(candles, i, config)
        armed = !!armResult
        if (armResult) {
          lower = armResult.lower
          upper = armResult.upper
          levels = armResult.levels
        }
      } else {
        halted = true
      }
      continue
    }

    if (pausedForChop) continue

    // Sells first: any held level whose target (next level up) was swept this bar.
    for (let li = 0; li < levels.length - 1; li++) {
      const level = levels[li]
      if (!level.held) continue
      const target = levels[li + 1].price
      if (candle.low <= target && target <= candle.high) {
        const quantity = level.entryQuote / level.entryPrice
        const exitQuote = quantity * target
        const exitFee = exitQuote * config.feeRatePerSide
        const feesQuote = level.entryFeeQuote + exitFee
        const pnlQuote = exitQuote - level.entryQuote - feesQuote
        trades.push({
          kind: SR_KIND_GRID_TRADE,
          id: randomUUID(),
          symbol,
          levelIndex: li,
          entryPrice: level.entryPrice,
          exitPrice: target,
          quantity,
          entryQuote: level.entryQuote,
          exitQuote,
          pnlQuote,
          feesQuote,
          reason: 'grid-fill',
          openedAt: level.openedAt,
          closedAt: at,
        })
        level.held = false
      }
    }

    // Buys: any unheld level (excluding the top ceiling) swept this bar.
    for (let li = 0; li < levels.length - 1; li++) {
      const level = levels[li]
      if (level.held) continue
      if (candle.low <= level.price && level.price <= candle.high) {
        level.held = true
        level.entryPrice = level.price
        level.entryQuote = config.quotePerGrid
        level.entryFeeQuote = config.quotePerGrid * config.feeRatePerSide
        level.openedAt = at
      }
    }
  }

  return {
    state: {
      kind: SR_KIND_GRID_STATE,
      symbol,
      armed,
      halted,
      pausedForChop,
      lower,
      upper,
      levels,
      lastProcessedOpenTime,
      updatedAt: now,
    },
    trades,
  }
}

// ── cycle orchestration (I/O + persistence + lock) ──────────────────────────

let gridCycleInProgress = false

export interface GridCycleResult {
  ran: boolean
  reason?: string
  trades: Array<GridPaperTrade>
  symbolsProcessed: number
}

export interface GridCycleOptions {
  /** Injectable for tests — defaults to the real public-API fetch. */
  fetchKlines?: typeof fetchBinanceKlines
}

async function runGridPaperCycleInner(options: GridCycleOptions): Promise<GridCycleResult> {
  // First global gate this paper-only engine has ever had — previously ran
  // regardless of emergencyKillSwitch/tradingMode. A tripped connectivity
  // breaker means repeated invalid-credential errors elsewhere (this engine
  // itself only reads public market data, never signs a request) — halting
  // here too avoids burning cycles while the underlying key problem exists.
  if (isConnectivityBreakerTripped()) {
    return { ran: false, reason: 'connectivity breaker tripped', trades: [], symbolsProcessed: 0 }
  }
  const fetchKlines = options.fetchKlines ?? fetchBinanceKlines
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const config = resolveGridEngineConfig(settings.demoTradingGrid)

  const rows = db.strategy_results
  const existingStates = rows.filter(
    (r) => r.kind === SR_KIND_GRID_STATE,
  ) as unknown as Array<GridSymbolState>
  const existingBySymbol = new Map(existingStates.map((s) => [s.symbol, s]))
  const existingTrades = rows.filter(
    (r) => r.kind === SR_KIND_GRID_TRADE,
  ) as unknown as Array<GridPaperTrade>

  const newStates: Array<GridSymbolState> = []
  const allNewTrades: Array<GridPaperTrade> = []

  for (const symbol of config.symbols) {
    const candles = await fetchKlines(symbol, config.interval, config.fetchCandleLimit)
    const persisted = existingBySymbol.get(symbol)
    const { state, trades } = advanceSymbolState(symbol, persisted, candles, config)
    newStates.push(state)
    allNewTrades.push(...trades)
  }

  // Replace only our own kinds — everything else (including every council
  // row) passes through untouched, mirroring demo-trading-engine.ts's
  // persist() pattern exactly.
  const others = rows.filter(
    (r) => r.kind !== SR_KIND_GRID_STATE && r.kind !== SR_KIND_GRID_TRADE,
  )
  const mergedTrades = [...existingTrades, ...allNewTrades].slice(-GRID_TRADE_LOG_CAP)
  db.strategy_results = [
    ...others,
    ...newStates.map((s) => ({ ...s })),
    ...mergedTrades.map((t) => ({ ...t })),
  ]
  db.updatedAt = new Date().toISOString()
  writeFinanceStore(db)

  return { ran: true, trades: allNewTrades, symbolsProcessed: config.symbols.length }
}

export async function runGridPaperCycle(
  options: GridCycleOptions = {},
): Promise<GridCycleResult> {
  if (gridCycleInProgress) {
    return { ran: false, reason: 'busy', trades: [], symbolsProcessed: 0 }
  }
  gridCycleInProgress = true
  try {
    return await runGridPaperCycleInner(options)
  } finally {
    gridCycleInProgress = false
  }
}

export interface GridPerformance {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnlQuote: number
  totalFeesQuote: number
}

/** Aggregate stats over ALL closed grid trades (not just the last-50 slice kept for display). */
export function summarizeGridTrades(
  trades: Array<GridPaperTrade>,
): GridPerformance {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnlQuote: 0,
      totalFeesQuote: 0,
    }
  }
  const wins = trades.filter((t) => t.pnlQuote > 0).length
  const losses = trades.filter((t) => t.pnlQuote < 0).length
  return {
    totalTrades: trades.length,
    wins,
    losses,
    winRate: wins / trades.length,
    totalPnlQuote: trades.reduce((sum, t) => sum + t.pnlQuote, 0),
    totalFeesQuote: trades.reduce((sum, t) => sum + t.feesQuote, 0),
  }
}

export function getGridEngineState(): {
  config: GridEngineConfig
  states: Array<GridSymbolState>
  trades: Array<GridPaperTrade>
  performance: GridPerformance
} {
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const rows = db.strategy_results
  const allTrades = rows.filter(
    (r) => r.kind === SR_KIND_GRID_TRADE,
  ) as unknown as Array<GridPaperTrade>
  return {
    config: resolveGridEngineConfig(settings.demoTradingGrid),
    states: rows.filter((r) => r.kind === SR_KIND_GRID_STATE) as unknown as Array<GridSymbolState>,
    trades: [...allTrades].slice(-50).reverse(),
    performance: summarizeGridTrades(allTrades),
  }
}
