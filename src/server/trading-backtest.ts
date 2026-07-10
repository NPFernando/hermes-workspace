/**
 * Offline backtest harness for the demo trading engine.
 *
 * Replays a historical candle series through the same pure building blocks the
 * live engine uses — the strategy council (trading-strategies) and the guardian
 * risk layer (trading-guardian) — and mirrors the live cycle mechanics from
 * demo-trading-engine.ts:
 *
 *   1. exits first: stop-loss / take-profit / opposite owner/council signal
 *   2. closed trades fold into per-strategy scores (applyTradeOutcome) and can
 *      trigger the loss-streak cooldown
 *   3. entries: council BUY/SELL with a lead strategy, sized by scaledQuoteSize,
 *      gated by checkOrderProposal — only when flat on the symbol. Default mode
 *      is still spot-long; short/long-short modes are offline research only.
 *
 * Deliberate differences from live, all conservative or unavoidable offline:
 *   - fills happen at candle close (live fills at the ticker price mid-cycle)
 *   - a configurable per-side fee is charged (live paper mode charges zero;
 *     testnet/live charge ~10 bps — that is the default here because the
 *     harness exists to inform the testnet_execute go/no-go decision)
 *   - the decision-quality / manual-override multipliers from the live engine
 *     are not simulated (they depend on live operational state)
 *
 * Results are returned as a report object; callers persist it themselves.
 * Nothing here writes to the finance store — backtest outcomes must never
 * leak into the live engine's strategy_results scores.
 */
import {
  STRATEGIES,
  applyTradeOutcome,
  atr,
  atrSizeMultiplier,
  councilVote,
  emptyScore,
  getStrategy,
  regimeAllowsLong,
  scaledQuoteSize,
  sma,
} from './trading-strategies'
import {
  DEFAULT_GUARDIAN_CONFIG,
  checkOrderProposal,
  cooldownUntil,
  dayKey,
  weekKey,
} from './trading-guardian'
import type { Candle, CouncilMember, StrategyScore } from './trading-strategies'
import type { GuardianConfig } from './trading-guardian'

export type BacktestScoreScope = 'global' | 'per_symbol'
export type BacktestScoreState = Record<string, StrategyScore>
export type BacktestPositionSide = 'long' | 'short'
export type BacktestTradeDirection = 'long' | 'short' | 'long_short'

export interface BacktestRunOptions {
  /** Seed strategy score/cooldown state before replaying the window. */
  initialScores?: BacktestScoreState
}

export interface BacktestCandleSplit {
  train: Record<string, Array<Candle>>
  test: Record<string, Array<Candle>>
}

export interface WalkForwardWindow extends BacktestCandleSplit {
  fold: number
  trainEndPct: number
  testStartPct: number
  testEndPct: number
}

export interface BacktestConfig {
  quotePerTrade: number
  stopLossPct: number
  takeProfitPct: number
  councilThreshold: number
  enabledStrategies: Array<string>
  guardian: GuardianConfig
  /** Candle window fed to strategies each step — live engine fetches ~100. */
  windowSize: number
  /** Commission per fill side as a fraction (0.001 = 10 bps Binance spot). */
  feeRatePerSide: number
  startingBalanceQuote: number
  /**
   * Long-SMA regime gate on BUY entries (0 = off). Uses the full candle
   * history up to the decision point, not the strategy window, so periods
   * longer than windowSize work. Exits are never gated.
   */
  regimeSmaPeriod: number
  /**
   * Trailing stop as a fraction below the position's high-water close
   * (0 = off). When on, it REPLACES the fixed take-profit — winners run
   * until price falls this far from the peak; the hard stop-loss from
   * entry still applies as the disaster floor.
   */
  trailingStopPct: number
  /** ATR lookback for volatility-scaled exits. Multiples of 0 disable ATR exits. */
  atrPeriod: number
  /** Stop distance = entry − ATR×multiple (0 = use fixed stopLossPct). */
  atrStopMultiple: number
  /** Target distance = entry + ATR×multiple (0 = use fixed takeProfitPct). */
  atrTakeProfitMultiple: number
  /** Trail distance = high-water close − ATR×multiple (0 = use trailingStopPct). */
  atrTrailingMultiple: number
  /**
   * Direction mode. `long` mirrors the spot engine. `short` and `long_short`
   * are offline-only research modes and must not be read as execution support.
   */
  tradeDirection: BacktestTradeDirection
  /**
   * Optional cross-market regime gate. When enabled, entries are filtered by a
   * benchmark symbol's long SMA: longs require benchmark >= SMA, shorts require
   * benchmark <= SMA. This is offline research only and fails open if the
   * benchmark is missing or under-warmed.
   */
  marketRegimeSymbol: string
  marketRegimeSmaPeriod: number
  /**
   * Strategy-score memory scope. `global` mirrors the live engine today: one
   * score per strategy shared across symbols. `per_symbol` is a research mode
   * that prevents ETH/BTC wins from improving the same strategy's BTC/ETH
   * weight and cooldown state.
   */
  scoreScope: BacktestScoreScope
  /** Fill-price penalty in basis points, applied to both entries and exits (0 = off). */
  slippageBps: number
  /** Skip new entries on a bar that gapped down more than this fraction from the prior close (0 = off). */
  gapDownGuardPct: number
  /**
   * Inverse-volatility position sizing (0 = off), mirrors the live engine's
   * atrSizeBaselinePct — independent of the atrStopMultiple/etc. exit fields.
   */
  atrSizeBaselinePct: number
  atrSizeMinMultiplier: number
  atrSizeMaxMultiplier: number
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  quotePerTrade: 25,
  stopLossPct: 0.02,
  takeProfitPct: 0.03,
  councilThreshold: 0.6,
  enabledStrategies: STRATEGIES.map((s) => s.id),
  guardian: DEFAULT_GUARDIAN_CONFIG,
  windowSize: 100,
  feeRatePerSide: 0.001,
  startingBalanceQuote: 10_000,
  regimeSmaPeriod: 0,
  scoreScope: 'global',
  trailingStopPct: 0,
  atrPeriod: 14,
  atrStopMultiple: 0,
  atrTakeProfitMultiple: 0,
  atrTrailingMultiple: 0,
  tradeDirection: 'long',
  marketRegimeSymbol: '',
  marketRegimeSmaPeriod: 0,
  slippageBps: 0,
  gapDownGuardPct: 0,
  atrSizeBaselinePct: 0,
  atrSizeMinMultiplier: 0.25,
  atrSizeMaxMultiplier: 1.5,
}

export interface BacktestTrade {
  side: BacktestPositionSide
  symbol: string
  strategyId: string
  entryPrice: number
  exitPrice: number
  quantity: number
  entryQuote: number
  exitQuote: number
  pnlQuote: number
  feesQuote: number
  reason: string
  openedAt: string
  closedAt: string
}

interface SimPosition {
  side: BacktestPositionSide
  symbol: string
  strategyId: string
  entryPrice: number
  quantity: number
  entryQuote: number
  entryFeeQuote: number
  openedAt: string
  /** Highest close seen while held — anchors long trailing stops. */
  highWaterPrice: number
  /** Lowest close seen while held — anchors short trailing stops. */
  lowWaterPrice: number
  /** ATR sampled at entry; all ATR exit levels are entry-anchored. */
  atrAtEntry: number | null
  atrStopPrice: number | null
  atrTakeProfitPrice: number | null
  atrTrailDistance: number | null
}

export interface StrategyReport extends StrategyScore {
  /** Present when scoreScope is `per_symbol`. */
  symbol?: string
  /** Gross wins / |gross losses| over this strategy's closed trades. */
  profitFactor: number | null
}

export interface BacktestReport {
  config: BacktestConfig
  symbols: Array<string>
  interval: string
  from: string
  to: string
  candleCount: number
  trades: Array<BacktestTrade>
  strategyReports: Array<StrategyReport>
  /** Final score state keyed by strategy id or `${symbol}:${strategyId}`. */
  scoreState: BacktestScoreState
  guardianBlocks: Record<string, number>
  totalPnlQuote: number
  totalFeesQuote: number
  returnPct: number
  maxDrawdownPct: number
  finalEquityQuote: number
  /** Per-symbol buy-and-hold return over the same span, for comparison. */
  buyAndHoldReturnPct: Record<string, number>
  equityCurve: Array<{ at: string; equity: number }>
  /** Risk-adjusted metrics computed from the equity curve — see computeRiskAdjustedMetrics. */
  riskAdjusted: RiskAdjustedMetrics
}

export interface RiskAdjustedMetrics {
  /** Annualized mean/stddev of equity-curve step returns. Null if too little data or zero variance. */
  sharpeRatio: number | null
  /** Annualized return ÷ max drawdown. Null if there was no drawdown to divide by. */
  calmarRatio: number | null
  /** returnPct scaled to a 365-day year — a research convenience for comparing runs of different lengths, not a compounding projection. */
  annualizedReturnPct: number | null
}

/**
 * Shared by both backtest harnesses (trading-backtest.ts and grid-backtest.ts)
 * — pure statistics, no domain coupling, same reuse pattern already used for
 * splitCandlesByIndex/buildWalkForwardWindows.
 *
 * Annualization is inferred from the equity curve's actual timestamps (points
 * per year), not from a hardcoded interval-to-periods table — this makes it
 * work unmodified for any candle interval (1h, 4h, 5m, 15m, ...).
 */
export function computeRiskAdjustedMetrics(
  equityCurve: Array<{ at: string; equity: number }>,
  returnPct: number,
  maxDrawdownPct: number,
): RiskAdjustedMetrics {
  if (equityCurve.length < 2) {
    return { sharpeRatio: null, calmarRatio: null, annualizedReturnPct: null }
  }
  const firstMs = Date.parse(equityCurve[0].at)
  const lastMs = Date.parse(equityCurve[equityCurve.length - 1].at)
  const yearsSpanned = (lastMs - firstMs) / (365 * 86_400_000)
  if (!Number.isFinite(yearsSpanned) || yearsSpanned <= 0) {
    return { sharpeRatio: null, calmarRatio: null, annualizedReturnPct: null }
  }

  const returns: Array<number> = []
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity
    const curr = equityCurve[i].equity
    if (prev > 0) returns.push((curr - prev) / prev)
  }

  let sharpeRatio: number | null = null
  if (returns.length >= 2) {
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length
    const variance =
      returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1)
    const stdDev = Math.sqrt(variance)
    // Below this, stdDev is floating-point noise around a truly constant
    // return series (e.g. compounding 1.01^i accumulates ~1e-15 rounding
    // error) rather than real volatility — treat it as zero.
    if (stdDev > 1e-9) {
      const periodsPerYear = returns.length / yearsSpanned
      sharpeRatio = (mean / stdDev) * Math.sqrt(periodsPerYear)
    } else {
      // Zero volatility: a steady gain is the best possible ratio (Infinity),
      // a steady loss or flat line has no meaningful ratio — same convention
      // profitFactor already uses elsewhere in this codebase for "no downside".
      sharpeRatio = mean > 0 ? Infinity : null
    }
  }

  const annualizedReturnPct = returnPct / yearsSpanned
  const calmarRatio =
    maxDrawdownPct > 0
      ? annualizedReturnPct / maxDrawdownPct
      : annualizedReturnPct > 0
        ? Infinity
        : null

  return { sharpeRatio, calmarRatio, annualizedReturnPct }
}

/** Realized PnL for trades closed on the same UTC day / ISO week as `now`. */
function realizedInBucket(
  trades: Array<BacktestTrade>,
  now: Date,
  keyOf: (d: Date | string) => string,
): number {
  const key = keyOf(now)
  let sum = 0
  for (const t of trades) if (keyOf(t.closedAt) === key) sum += t.pnlQuote
  return sum
}

function scoreKey(
  strategyId: string,
  symbol: string,
  scope: BacktestScoreScope,
): string {
  return scope === 'per_symbol' ? `${symbol}:${strategyId}` : strategyId
}

function initScores(
  symbols: Array<string>,
  strategies: typeof STRATEGIES,
  scope: BacktestScoreScope,
  initialScores: BacktestScoreState = {},
): Map<string, StrategyScore> {
  const scores = new Map<string, StrategyScore>()
  for (const strategy of strategies) {
    if (scope === 'global') {
      scores.set(strategy.id, {
        ...(initialScores[strategy.id] ?? emptyScore(strategy.id)),
      })
      continue
    }
    for (const symbol of symbols) {
      const key = scoreKey(strategy.id, symbol, scope)
      scores.set(key, { ...(initialScores[key] ?? emptyScore(strategy.id)) })
    }
  }
  return scores
}

function entrySideForSignal(
  signal: 'BUY' | 'SELL' | 'HOLD',
  direction: BacktestTradeDirection,
): BacktestPositionSide | null {
  if (signal === 'BUY' && direction !== 'short') return 'long'
  if (signal === 'SELL' && direction !== 'long') return 'short'
  return null
}

function exitSignalForSide(side: BacktestPositionSide): 'BUY' | 'SELL' {
  return side === 'long' ? 'SELL' : 'BUY'
}

function favorableMovePct(pos: SimPosition, price: number): number {
  const raw = (price - pos.entryPrice) / pos.entryPrice
  return pos.side === 'long' ? raw : -raw
}

function unrealizedPnlQuote(pos: SimPosition, price: number): number {
  const markQuote = pos.quantity * price
  return pos.side === 'long'
    ? markQuote - pos.entryQuote
    : pos.entryQuote - markQuote
}

function openEquityQuote(pos: SimPosition, price: number): number {
  if (pos.side === 'long') return pos.quantity * price
  return pos.entryQuote + unrealizedPnlQuote(pos, price)
}

function atrStopPrice(
  side: BacktestPositionSide,
  entryPrice: number,
  entryAtr: number | null,
  multiple: number,
): number | null {
  if (entryAtr == null || multiple <= 0) return null
  return side === 'long'
    ? entryPrice - entryAtr * multiple
    : entryPrice + entryAtr * multiple
}

function atrTakeProfitPrice(
  side: BacktestPositionSide,
  entryPrice: number,
  entryAtr: number | null,
  multiple: number,
): number | null {
  if (entryAtr == null || multiple <= 0) return null
  return side === 'long'
    ? entryPrice + entryAtr * multiple
    : entryPrice - entryAtr * multiple
}

function regimeAllowsSide(
  side: BacktestPositionSide,
  closes: Array<number>,
  period: number,
): boolean {
  if (period <= 0) return true
  const average = sma(closes, period)
  if (average == null) return true
  const last = closes[closes.length - 1]
  return side === 'long' ? last >= average : last <= average
}

function closesUpTo(
  candles: Array<Candle> | undefined,
  openTime: number,
  period: number,
): Array<number> {
  if (!candles || period <= 0) return []
  let end = 0
  while (end < candles.length && candles[end].openTime <= openTime) end++
  return candles.slice(Math.max(0, end - period), end).map((c) => c.close)
}

function scoreStateFromMap(
  scores: Map<string, StrategyScore>,
): BacktestScoreState {
  return Object.fromEntries(
    [...scores.entries()].map(([key, score]) => [key, { ...score }]),
  )
}

function assertEnoughCandles(
  candlesBySymbol: Record<string, Array<Candle>>,
): void {
  for (const [symbol, candles] of Object.entries(candlesBySymbol)) {
    if (candles.length < 2) {
      throw new Error(
        `${symbol} needs at least 2 candles for an in-sample/out-of-sample split`,
      )
    }
  }
}

function splitIndexForPct(candleCount: number, splitPct: number): number {
  return Math.max(
    1,
    Math.min(candleCount - 1, Math.floor((candleCount * splitPct) / 100)),
  )
}

function validatePct(name: string, pct: number): void {
  if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) {
    throw new Error(`${name} must be a number greater than 0 and less than 100`)
  }
}

export function splitCandlesByIndex(
  candlesBySymbol: Record<string, Array<Candle>>,
  splitPct: number,
): BacktestCandleSplit {
  validatePct('splitPct', splitPct)
  assertEnoughCandles(candlesBySymbol)

  const train: Record<string, Array<Candle>> = {}
  const test: Record<string, Array<Candle>> = {}
  for (const [symbol, candles] of Object.entries(candlesBySymbol)) {
    const split = splitIndexForPct(candles.length, splitPct)
    train[symbol] = candles.slice(0, split)
    test[symbol] = candles.slice(split)
  }
  return { train, test }
}

function walkForwardBoundaries(
  symbol: string,
  candleCount: number,
  initialTrainPct: number,
  folds: number,
): Array<number> {
  const firstTestStart = splitIndexForPct(candleCount, initialTrainPct)
  const outOfSampleCandles = candleCount - firstTestStart
  if (outOfSampleCandles < folds) {
    throw new Error(
      `${symbol} has ${outOfSampleCandles} out-of-sample candles after the initial train window; need at least ${folds} for ${folds} folds`,
    )
  }

  const boundaries = [firstTestStart]
  const remainingPct = 100 - initialTrainPct
  for (let i = 1; i < folds; i++) {
    const targetPct = initialTrainPct + (remainingPct * i) / folds
    const raw = Math.floor((candleCount * targetPct) / 100)
    const min = boundaries[i - 1] + 1
    const max = candleCount - (folds - i)
    boundaries.push(Math.max(min, Math.min(max, raw)))
  }
  boundaries.push(candleCount)
  return boundaries
}

export function buildWalkForwardWindows(
  candlesBySymbol: Record<string, Array<Candle>>,
  initialTrainPct: number,
  folds: number,
): Array<WalkForwardWindow> {
  validatePct('initialTrainPct', initialTrainPct)
  assertEnoughCandles(candlesBySymbol)

  const foldCount = Math.trunc(folds)
  if (!Number.isFinite(folds) || foldCount < 1) {
    throw new Error('folds must be a positive integer')
  }

  const boundariesBySymbol = Object.fromEntries(
    Object.entries(candlesBySymbol).map(([symbol, candles]) => [
      symbol,
      walkForwardBoundaries(symbol, candles.length, initialTrainPct, foldCount),
    ]),
  ) as Record<string, Array<number>>

  const remainingPct = 100 - initialTrainPct
  return Array.from({ length: foldCount }, (_, i) => {
    const train: Record<string, Array<Candle>> = {}
    const test: Record<string, Array<Candle>> = {}
    for (const [symbol, candles] of Object.entries(candlesBySymbol)) {
      const boundaries = boundariesBySymbol[symbol]
      const trainEnd = boundaries[i]
      const testEnd = boundaries[i + 1]
      train[symbol] = candles.slice(0, trainEnd)
      test[symbol] = candles.slice(trainEnd, testEnd)
    }
    const testStartPct = initialTrainPct + (remainingPct * i) / foldCount
    const testEndPct = initialTrainPct + (remainingPct * (i + 1)) / foldCount
    return {
      fold: i + 1,
      train,
      test,
      trainEndPct: testStartPct,
      testStartPct,
      testEndPct,
    }
  })
}

/**
 * Trade-direction-aware fill penalty: buys fill worse (higher), sells fill
 * worse (lower). Models the gap between a backtest's nominal signal price
 * and what a real order would actually fill at. 0 = off (default), which
 * reproduces today's zero-slippage fills exactly.
 */
export function applyFillSlippage(
  nominalPrice: number,
  side: 'buy' | 'sell',
  slippageBps: number,
): number {
  if (slippageBps <= 0) return nominalPrice
  const factor = slippageBps / 10_000
  return side === 'buy' ? nominalPrice * (1 + factor) : nominalPrice * (1 - factor)
}

/**
 * True when this bar gapped down from the prior close by more than the guard
 * threshold — a stand-in for "the order couldn't have filled at the nominal
 * price because the market gapped past it overnight." Entries only; a
 * stop-loss must always be allowed to fire, so this is never applied to exits.
 */
export function gapDownGuardTriggered(
  candleOpen: number,
  previousClose: number | undefined,
  gapDownGuardPct: number,
): boolean {
  if (gapDownGuardPct <= 0 || !previousClose || previousClose <= 0) return false
  return (previousClose - candleOpen) / previousClose > gapDownGuardPct
}

export function runBacktest(
  candlesBySymbol: Record<string, Array<Candle>>,
  interval: string,
  config: BacktestConfig = DEFAULT_BACKTEST_CONFIG,
  options: BacktestRunOptions = {},
): BacktestReport {
  const symbols = Object.keys(candlesBySymbol)
  const strategies = STRATEGIES.filter((s) =>
    config.enabledStrategies.includes(s.id),
  )

  // Unified chronological timeline across symbols.
  const timeline = [
    ...new Set(
      symbols.flatMap((s) => candlesBySymbol[s].map((c) => c.openTime)),
    ),
  ].sort((a, b) => a - b)

  // Per-symbol cursor into its (chronologically sorted) candle array.
  const sorted: Record<string, Array<Candle>> = {}
  for (const s of symbols) {
    sorted[s] = [...candlesBySymbol[s]].sort((a, b) => a.openTime - b.openTime)
  }
  const cursor: Record<string, number> = Object.fromEntries(
    symbols.map((s) => [s, 0]),
  )
  const lastClose: Record<string, number> = {}
  const marketRegimeSymbol = config.marketRegimeSymbol.trim().toUpperCase()

  const scores = initScores(
    symbols,
    strategies,
    config.scoreScope,
    options.initialScores,
  )
  let positions: Array<SimPosition> = []
  const trades: Array<BacktestTrade> = []
  const guardianBlocks: Record<string, number> = {}
  let quoteBalance = config.startingBalanceQuote
  const equityCurve: Array<{ at: string; equity: number }> = []
  let peakEquity = config.startingBalanceQuote
  let maxDrawdownPct = 0

  const closePosition = (
    pos: SimPosition,
    price: number,
    reason: string,
    now: Date,
  ) => {
    // Mirrors the live close: gross exit value minus the round-trip fees
    // (entry fee was carried on the position, settled here in quote terms).
    // Slippage affects the fill price only — the trigger comparisons above
    // that decided to close already ran against the nominal candle price.
    const exitFillSide = pos.side === 'long' ? 'sell' : 'buy'
    const exitFillPrice = applyFillSlippage(price, exitFillSide, config.slippageBps)
    const exitQuote = pos.quantity * exitFillPrice
    const exitFee = exitQuote * config.feeRatePerSide
    const feesQuote = pos.entryFeeQuote + exitFee
    const pnlQuote =
      pos.side === 'long'
        ? exitQuote - pos.entryQuote - feesQuote
        : pos.entryQuote - exitQuote - feesQuote
    quoteBalance +=
      pos.side === 'long' ? exitQuote - feesQuote : pos.entryQuote + pnlQuote

    let next = applyTradeOutcome(
      scores.get(scoreKey(pos.strategyId, pos.symbol, config.scoreScope)) ??
        emptyScore(pos.strategyId),
      pnlQuote,
      pos.entryQuote,
    )
    if (next.lossStreak >= config.guardian.lossStreakLimit) {
      next = { ...next, cooldownUntil: cooldownUntil(config.guardian, now) }
    }
    scores.set(scoreKey(pos.strategyId, pos.symbol, config.scoreScope), next)

    trades.push({
      side: pos.side,
      symbol: pos.symbol,
      strategyId: pos.strategyId,
      entryPrice: pos.entryPrice,
      exitPrice: exitFillPrice,
      quantity: pos.quantity,
      entryQuote: pos.entryQuote,
      exitQuote,
      pnlQuote,
      feesQuote,
      reason,
      openedAt: pos.openedAt,
      closedAt: now.toISOString(),
    })
    positions = positions.filter((p) => p !== pos)
  }

  for (const openTime of timeline) {
    for (const symbol of symbols) {
      const series = sorted[symbol]
      const i = cursor[symbol]
      if (i >= series.length || series[i].openTime !== openTime) continue
      cursor[symbol] = i + 1

      const candle = series[i]
      const price = candle.close
      const previousClose = lastClose[symbol]
      lastClose[symbol] = price
      const now = new Date(candle.openTime + 1) // decision time ≈ candle close
      const window = series.slice(Math.max(0, i + 1 - config.windowSize), i + 1)

      const members: Array<CouncilMember> = strategies.map((s) => ({
        strategyId: s.id,
        decision: s.evaluate(window),
        score:
          scores.get(scoreKey(s.id, symbol, config.scoreScope))?.score ?? 0,
      }))
      const vote = councilVote(members, config.councilThreshold)

      // 1. Exits first — same precedence as the live cycle.
      for (const pos of positions.filter((p) => p.symbol === symbol)) {
        if (price > pos.highWaterPrice) pos.highWaterPrice = price
        if (price < pos.lowWaterPrice) pos.lowWaterPrice = price
        const ownerDecision = getStrategy(pos.strategyId)?.evaluate(window)
        const movePct = favorableMovePct(pos, price)
        const hitAtrStop =
          pos.atrStopPrice != null &&
          (pos.side === 'long'
            ? price <= pos.atrStopPrice
            : price >= pos.atrStopPrice)
        const hitFixedStop =
          pos.atrStopPrice == null && movePct <= -config.stopLossPct
        const pctTrailPrice =
          config.trailingStopPct > 0
            ? pos.side === 'long'
              ? pos.highWaterPrice * (1 - config.trailingStopPct)
              : pos.lowWaterPrice * (1 + config.trailingStopPct)
            : null
        const atrTrailPrice =
          pos.atrTrailDistance != null
            ? pos.side === 'long'
              ? pos.highWaterPrice - pos.atrTrailDistance
              : pos.lowWaterPrice + pos.atrTrailDistance
            : null
        const hitAtrTrail =
          atrTrailPrice != null &&
          (pos.side === 'long'
            ? price <= atrTrailPrice
            : price >= atrTrailPrice)
        const hitPctTrail =
          atrTrailPrice == null &&
          pctTrailPrice != null &&
          (pos.side === 'long'
            ? price <= pctTrailPrice
            : price >= pctTrailPrice)
        const trailing = atrTrailPrice != null || pctTrailPrice != null
        const hitAtrTarget =
          !trailing &&
          pos.atrTakeProfitPrice != null &&
          (pos.side === 'long'
            ? price >= pos.atrTakeProfitPrice
            : price <= pos.atrTakeProfitPrice)
        // Trailing mode replaces the fixed/ATR take-profit: winners run.
        const hitFixedTarget =
          !trailing &&
          pos.atrTakeProfitPrice == null &&
          movePct >= config.takeProfitPct
        const exitSignal = exitSignalForSide(pos.side)
        const ownerExit = ownerDecision?.signal === exitSignal
        const councilExit = vote.signal === exitSignal
        if (
          hitAtrStop ||
          hitFixedStop ||
          hitAtrTrail ||
          hitPctTrail ||
          hitAtrTarget ||
          hitFixedTarget ||
          ownerExit ||
          councilExit
        ) {
          const reason = hitAtrStop
            ? `atr-stop ${(movePct * 100).toFixed(2)}% (ATR ${pos.atrAtEntry?.toFixed(2) ?? '?'})`
            : hitFixedStop
              ? `stop-loss ${(movePct * 100).toFixed(2)}%`
              : hitAtrTrail
                ? `atr-trailing-stop ${(movePct * 100).toFixed(2)}% (${pos.side === 'long' ? 'peak' : 'trough'} ${(pos.side === 'long' ? pos.highWaterPrice : pos.lowWaterPrice).toFixed(2)}, ATR ${pos.atrAtEntry?.toFixed(2) ?? '?'})`
                : hitPctTrail
                  ? `trailing-stop ${(movePct * 100).toFixed(2)}% (${pos.side === 'long' ? 'peak' : 'trough'} ${(pos.side === 'long' ? pos.highWaterPrice : pos.lowWaterPrice).toFixed(2)})`
                  : hitAtrTarget
                    ? `atr-target ${(movePct * 100).toFixed(2)}% (ATR ${pos.atrAtEntry?.toFixed(2) ?? '?'})`
                    : hitFixedTarget
                      ? `take-profit ${(movePct * 100).toFixed(2)}%`
                      : ownerExit
                        ? `strategy exit: ${ownerDecision.reason}`
                        : `council exit (net ${vote.net.toFixed(2)})`
          closePosition(pos, price, reason, now)
        }
      }

      // 2. Entries — council direction, flat on the symbol, guardian approval.
      const stillHeld = positions.some((p) => p.symbol === symbol)
      const entrySide = entrySideForSignal(vote.signal, config.tradeDirection)
      if (!stillHeld && entrySide != null && vote.leadStrategyId) {
        if (gapDownGuardTriggered(candle.open, previousClose, config.gapDownGuardPct)) {
          guardianBlocks.gap_down_guard = (guardianBlocks.gap_down_guard || 0) + 1
          continue
        }
        const regimeCloses = series
          .slice(Math.max(0, i + 1 - config.regimeSmaPeriod), i + 1)
          .map((c) => c.close)
        if (
          entrySide === 'long' &&
          !regimeAllowsLong(regimeCloses, config.regimeSmaPeriod)
        ) {
          guardianBlocks.regime_below_long_sma =
            (guardianBlocks.regime_below_long_sma || 0) + 1
          continue
        }
        if (
          marketRegimeSymbol &&
          config.marketRegimeSmaPeriod > 0 &&
          !regimeAllowsSide(
            entrySide,
            closesUpTo(
              sorted[marketRegimeSymbol],
              openTime,
              config.marketRegimeSmaPeriod,
            ),
            config.marketRegimeSmaPeriod,
          )
        ) {
          const block =
            entrySide === 'long'
              ? 'market_regime_below_sma'
              : 'market_regime_above_sma'
          guardianBlocks[block] = (guardianBlocks[block] || 0) + 1
          continue
        }
        const leadScore =
          scores.get(
            scoreKey(vote.leadStrategyId, symbol, config.scoreScope),
          ) ?? emptyScore(vote.leadStrategyId)
        const sizeAtrMult =
          config.atrSizeBaselinePct > 0
            ? atrSizeMultiplier(
                atr(window, config.atrPeriod),
                price,
                config.atrSizeBaselinePct,
                config.atrSizeMinMultiplier,
                config.atrSizeMaxMultiplier,
              )
            : 1
        const proposedQuote = Math.max(
          1,
          scaledQuoteSize(config.quotePerTrade, leadScore.score) * sizeAtrMult,
        )
        const openUnrealized = positions.reduce(
          (sum, p) =>
            sum + unrealizedPnlQuote(p, lastClose[p.symbol] ?? p.entryPrice),
          0,
        )
        const verdict = checkOrderProposal(
          {
            symbol,
            strategyId: vote.leadStrategyId,
            quoteAmount: proposedQuote,
          },
          {
            openPositions: positions.length,
            quoteBalance,
            dailyPnlQuote: realizedInBucket(trades, now, dayKey),
            weeklyPnlQuote: realizedInBucket(trades, now, weekKey),
            openUnrealizedPnlQuote: openUnrealized,
            strategyLossStreak: leadScore.lossStreak,
            strategyCooldownUntil: leadScore.cooldownUntil,
            now,
          },
          config.guardian,
        )
        if (!verdict.allowed) {
          for (const block of verdict.blocks) {
            guardianBlocks[block.rule] = (guardianBlocks[block.rule] ?? 0) + 1
          }
        } else {
          // Gross fill like the live engine's executedQty; the entry fee is
          // carried on the position and settled at close. Slippage is applied
          // to the actual fill (quantity bought, and the entry anchor used
          // for stop/target geometry) — mirrors how the live engine anchors
          // stops to the real fill price, not a hypothetical unslipped one.
          const entryFillSide = entrySide === 'long' ? 'buy' : 'sell'
          const entryFillPrice = applyFillSlippage(price, entryFillSide, config.slippageBps)
          const spent = verdict.approvedQuote
          const entryFee = spent * config.feeRatePerSide
          const quantity = spent / entryFillPrice
          const entryAtr = atr(window, config.atrPeriod)
          quoteBalance -= spent
          positions.push({
            side: entrySide,
            symbol,
            strategyId: vote.leadStrategyId,
            entryPrice: entryFillPrice,
            quantity,
            entryQuote: spent,
            entryFeeQuote: entryFee,
            openedAt: now.toISOString(),
            highWaterPrice: entryFillPrice,
            lowWaterPrice: entryFillPrice,
            atrAtEntry: entryAtr,
            atrStopPrice: atrStopPrice(
              entrySide,
              entryFillPrice,
              entryAtr,
              config.atrStopMultiple,
            ),
            atrTakeProfitPrice: atrTakeProfitPrice(
              entrySide,
              entryFillPrice,
              entryAtr,
              config.atrTakeProfitMultiple,
            ),
            atrTrailDistance:
              entryAtr != null && config.atrTrailingMultiple > 0
                ? entryAtr * config.atrTrailingMultiple
                : null,
          })
        }
      }
    }

    // Mark-to-market equity after every timestep.
    const equity =
      quoteBalance +
      positions.reduce(
        (sum, p) =>
          sum + openEquityQuote(p, lastClose[p.symbol] ?? p.entryPrice),
        0,
      )
    equityCurve.push({ at: new Date(openTime).toISOString(), equity })
    if (equity > peakEquity) peakEquity = equity
    const drawdown = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0
    if (drawdown > maxDrawdownPct) maxDrawdownPct = drawdown
  }

  // Close whatever is still open at the final price so results are realized.
  const endTime = new Date(timeline[timeline.length - 1] + 1)
  for (const pos of [...positions]) {
    closePosition(
      pos,
      lastClose[pos.symbol] ?? pos.entryPrice,
      'end of backtest',
      endTime,
    )
  }

  const strategyReports: Array<StrategyReport> = [...scores.entries()].map(
    ([key, score]) => {
      const symbol =
        config.scoreScope === 'per_symbol' ? key.split(':')[0] : undefined
      const own = trades.filter(
        (t) =>
          t.strategyId === score.strategyId &&
          (symbol === undefined || t.symbol === symbol),
      )
      const wins = own.filter((t) => t.pnlQuote > 0).length
      const losses = own.filter((t) => t.pnlQuote < 0).length
      const totalPnlQuote = own.reduce((s, t) => s + t.pnlQuote, 0)
      const grossWin = own.reduce((s, t) => s + Math.max(0, t.pnlQuote), 0)
      const grossLoss = own.reduce((s, t) => s + Math.min(0, t.pnlQuote), 0)
      return {
        strategyId: score.strategyId,
        trades: own.length,
        wins,
        losses,
        totalPnlQuote,
        score: score.score,
        winRate: own.length > 0 ? wins / own.length : 0,
        avgPnlQuote: own.length > 0 ? totalPnlQuote / own.length : 0,
        lossStreak: score.lossStreak,
        cooldownUntil: score.cooldownUntil,
        updatedAt: score.updatedAt,
        symbol,
        profitFactor: grossLoss < 0 ? grossWin / -grossLoss : null,
      }
    },
  )

  const totalPnlQuote = trades.reduce((s, t) => s + t.pnlQuote, 0)
  const finalEquityQuote = quoteBalance
  const buyAndHoldReturnPct: Record<string, number> = {}
  for (const s of symbols) {
    const series = sorted[s]
    if (series.length >= 2) {
      buyAndHoldReturnPct[s] =
        ((series[series.length - 1].close - series[0].close) /
          series[0].close) *
        100
    }
  }

  const returnPct =
    ((finalEquityQuote - config.startingBalanceQuote) /
      config.startingBalanceQuote) *
    100
  const maxDrawdownPctValue = maxDrawdownPct * 100

  return {
    config,
    symbols,
    interval,
    from: new Date(timeline[0]).toISOString(),
    to: new Date(timeline[timeline.length - 1]).toISOString(),
    candleCount: timeline.length,
    trades,
    strategyReports,
    scoreState: scoreStateFromMap(scores),
    guardianBlocks,
    totalPnlQuote,
    totalFeesQuote: trades.reduce((s, t) => s + t.feesQuote, 0),
    returnPct,
    maxDrawdownPct: maxDrawdownPctValue,
    finalEquityQuote,
    buyAndHoldReturnPct,
    equityCurve,
    riskAdjusted: computeRiskAdjustedMetrics(
      equityCurve,
      returnPct,
      maxDrawdownPctValue,
    ),
  }
}
