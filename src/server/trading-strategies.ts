/**
 * Pluggable trading strategies + per-strategy scoring.
 *
 * A strategy is a pure function from a candle series to a signal. Strategies
 * carry no I/O and no state — the loop feeds them market data and records the
 * outcome of any trade they trigger, so formulas can be refined from the
 * accumulated score history without touching execution code.
 */

export type Signal = 'BUY' | 'SELL' | 'HOLD'

export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface StrategyDecision {
  signal: Signal
  /** 0..1 confidence used for ranking and (later) capital sizing. */
  confidence: number
  reason: string
}

export interface Strategy {
  id: string
  name: string
  description: string
  /** Minimum candles required before the strategy can emit a non-HOLD. */
  minCandles: number
  evaluate: (candles: Array<Candle>, params?: Record<string, number>) => StrategyDecision
}

const HOLD = (reason: string): StrategyDecision => ({ signal: 'HOLD', confidence: 0, reason })

export function sma(values: Array<number>, period: number): number | null {
  if (values.length < period) return null
  let sum = 0
  for (let i = values.length - period; i < values.length; i++) sum += values[i]
  return sum / period
}

/** Wilder's RSI over `period` closes. Returns null if insufficient data. */
export function rsi(closes: Array<number>, period: number): number | null {
  if (closes.length < period + 1) return null
  let gain = 0
  let loss = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gain += diff
    else loss -= diff
  }
  const avgGain = gain / period
  const avgLoss = loss / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** SMA crossover: fast SMA over slow SMA → BUY; under → SELL. */
export const smaCrossoverStrategy: Strategy = {
  id: 'sma_crossover',
  name: 'SMA Crossover',
  description: 'Fast/slow simple-moving-average crossover trend follower.',
  minCandles: 21,
  evaluate(candles, params) {
    const fastP = Math.round(params?.fast ?? 9)
    const slowP = Math.round(params?.slow ?? 21)
    if (candles.length < slowP + 1) return HOLD('not enough candles')
    const closes = candles.map((c) => c.close)
    const prev = closes.slice(0, -1)
    const fastNow = sma(closes, fastP)
    const slowNow = sma(closes, slowP)
    const fastPrev = sma(prev, fastP)
    const slowPrev = sma(prev, slowP)
    if (fastNow == null || slowNow == null || fastPrev == null || slowPrev == null) {
      return HOLD('moving averages unavailable')
    }
    const spread = Math.abs(fastNow - slowNow) / slowNow
    const confidence = Math.min(1, spread * 50)
    if (fastPrev <= slowPrev && fastNow > slowNow) {
      return { signal: 'BUY', confidence, reason: `fast SMA(${fastP}) crossed above slow SMA(${slowP})` }
    }
    if (fastPrev >= slowPrev && fastNow < slowNow) {
      return { signal: 'SELL', confidence, reason: `fast SMA(${fastP}) crossed below slow SMA(${slowP})` }
    }
    return HOLD('no crossover')
  },
}

/** RSI mean-reversion: oversold → BUY, overbought → SELL. */
export const rsiReversionStrategy: Strategy = {
  id: 'rsi_reversion',
  name: 'RSI Mean Reversion',
  description: 'Buys oversold and sells overbought RSI extremes.',
  minCandles: 15,
  evaluate(candles, params) {
    const period = Math.round(params?.period ?? 14)
    const low = params?.oversold ?? 30
    const high = params?.overbought ?? 70
    const closes = candles.map((c) => c.close)
    const value = rsi(closes, period)
    if (value == null) return HOLD('not enough candles for RSI')
    if (value <= low) {
      return { signal: 'BUY', confidence: Math.min(1, (low - value) / low + 0.2), reason: `RSI ${value.toFixed(1)} <= ${low} (oversold)` }
    }
    if (value >= high) {
      return { signal: 'SELL', confidence: Math.min(1, (value - high) / (100 - high) + 0.2), reason: `RSI ${value.toFixed(1)} >= ${high} (overbought)` }
    }
    return HOLD(`RSI ${value.toFixed(1)} neutral`)
  },
}

export const STRATEGIES: Array<Strategy> = [smaCrossoverStrategy, rsiReversionStrategy]

export function getStrategy(id: string): Strategy | undefined {
  return STRATEGIES.find((s) => s.id === id)
}

// ── Scoring ────────────────────────────────────────────────────────────────

export interface StrategyScore {
  strategyId: string
  trades: number
  wins: number
  losses: number
  totalPnlQuote: number
  /** Running score: +1 weighted by profit on a win, −1 weighted by loss. */
  score: number
  winRate: number
  avgPnlQuote: number
  updatedAt: string
}

export function emptyScore(strategyId: string): StrategyScore {
  return {
    strategyId,
    trades: 0,
    wins: 0,
    losses: 0,
    totalPnlQuote: 0,
    score: 0,
    winRate: 0,
    avgPnlQuote: 0,
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Fold a closed trade's realized PnL (in quote currency, e.g. USDT) into a
 * strategy's score. Profit adds a reward scaled by return; loss subtracts.
 */
export function applyTradeOutcome(
  score: StrategyScore,
  pnlQuote: number,
  entryQuote: number,
): StrategyScore {
  const trades = score.trades + 1
  const wins = score.wins + (pnlQuote > 0 ? 1 : 0)
  const losses = score.losses + (pnlQuote < 0 ? 1 : 0)
  const totalPnlQuote = score.totalPnlQuote + pnlQuote
  // Reward proportional to return-on-entry, clamped so one lucky trade can't
  // dominate; symmetric penalty on losses.
  const roi = entryQuote > 0 ? pnlQuote / entryQuote : 0
  const delta = Math.max(-1, Math.min(1, roi * 10))
  const nextScore = score.score + delta
  return {
    strategyId: score.strategyId,
    trades,
    wins,
    losses,
    totalPnlQuote,
    score: nextScore,
    winRate: trades > 0 ? wins / trades : 0,
    avgPnlQuote: trades > 0 ? totalPnlQuote / trades : 0,
    updatedAt: new Date().toISOString(),
  }
}
