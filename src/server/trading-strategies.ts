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

/** Exponential moving average over the full series; returns the last value. */
export function ema(values: Array<number>, period: number): number | null {
  if (values.length < period) return null
  const k = 2 / (period + 1)
  let value = sma(values.slice(0, period), period)!
  for (let i = period; i < values.length; i++) {
    value = values[i] * k + value * (1 - k)
  }
  return value
}

/** MACD line series (fast EMA − slow EMA) for the tail of the series. */
function macdSeries(closes: Array<number>, fast: number, slow: number): Array<number> {
  const out: Array<number> = []
  for (let end = slow; end <= closes.length; end++) {
    const window = closes.slice(0, end)
    const f = ema(window, fast)
    const s = ema(window, slow)
    if (f != null && s != null) out.push(f - s)
  }
  return out
}

/** MACD momentum: MACD line crossing its signal line. */
export const macdMomentumStrategy: Strategy = {
  id: 'macd_momentum',
  name: 'MACD Momentum',
  description: 'MACD(12,26) line crossing its 9-period signal line.',
  minCandles: 40,
  evaluate(candles, params) {
    const fast = Math.round(params?.fast ?? 12)
    const slow = Math.round(params?.slow ?? 26)
    const signalP = Math.round(params?.signal ?? 9)
    const closes = candles.map((c) => c.close)
    if (closes.length < slow + signalP + 2) return HOLD('not enough candles for MACD')
    const macd = macdSeries(closes, fast, slow)
    if (macd.length < signalP + 2) return HOLD('not enough MACD history')
    const signalNow = ema(macd, signalP)
    const signalPrev = ema(macd.slice(0, -1), signalP)
    const macdNow = macd[macd.length - 1]
    const macdPrev = macd[macd.length - 2]
    if (signalNow == null || signalPrev == null) return HOLD('signal line unavailable')
    const price = closes[closes.length - 1]
    const spread = Math.abs(macdNow - signalNow) / (price || 1)
    const confidence = Math.min(1, spread * 400 + 0.15)
    if (macdPrev <= signalPrev && macdNow > signalNow) {
      return { signal: 'BUY', confidence, reason: 'MACD crossed above signal line' }
    }
    if (macdPrev >= signalPrev && macdNow < signalNow) {
      return { signal: 'SELL', confidence, reason: 'MACD crossed below signal line' }
    }
    return HOLD('no MACD cross')
  },
}

/** Donchian-style breakout: close beyond the prior N-candle extreme. */
export const breakoutStrategy: Strategy = {
  id: 'breakout',
  name: 'Channel Breakout',
  description: 'Close breaking above/below the prior N-candle high/low.',
  minCandles: 22,
  evaluate(candles, params) {
    const lookback = Math.round(params?.lookback ?? 20)
    if (candles.length < lookback + 1) return HOLD('not enough candles')
    const prior = candles.slice(-lookback - 1, -1)
    const last = candles[candles.length - 1]
    const priorHigh = Math.max(...prior.map((c) => c.high))
    const priorLow = Math.min(...prior.map((c) => c.low))
    if (last.close > priorHigh) {
      const conf = Math.min(1, (last.close - priorHigh) / priorHigh * 100 + 0.25)
      return { signal: 'BUY', confidence: conf, reason: `close ${last.close.toFixed(2)} broke ${lookback}-candle high ${priorHigh.toFixed(2)}` }
    }
    if (last.close < priorLow) {
      const conf = Math.min(1, (priorLow - last.close) / priorLow * 100 + 0.25)
      return { signal: 'SELL', confidence: conf, reason: `close ${last.close.toFixed(2)} broke ${lookback}-candle low ${priorLow.toFixed(2)}` }
    }
    return HOLD('inside channel')
  },
}

export const STRATEGIES: Array<Strategy> = [
  smaCrossoverStrategy,
  rsiReversionStrategy,
  macdMomentumStrategy,
  breakoutStrategy,
]

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
  /** Consecutive losses (reset on any win) — feeds the guardian cooldown. */
  lossStreak: number
  /** ISO timestamp while the strategy sits out after a loss streak. */
  cooldownUntil?: string | null
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
    lossStreak: 0,
    cooldownUntil: null,
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
    lossStreak: pnlQuote < 0 ? (score.lossStreak ?? 0) + 1 : 0,
    cooldownUntil: pnlQuote < 0 ? score.cooldownUntil ?? null : null,
    updatedAt: new Date().toISOString(),
  }
}

// ── Council vote (VT-Capital council concept) ───────────────────────────────

export interface CouncilMember {
  strategyId: string
  decision: StrategyDecision
  score: number
}

export interface CouncilVote {
  signal: Signal
  /** Net weighted vote in [-inf, +inf]; sign gives direction. */
  net: number
  /** Strategy contributing the strongest weight in the winning direction. */
  leadStrategyId: string | null
  reasons: Array<string>
}

/** Track-record weight: proven strategies count more, losers count less. */
export function strategyWeight(score: number): number {
  return Math.max(0.5, Math.min(1.5, 1 + score * 0.1))
}

/**
 * Combine every enabled strategy's opinion into one decision. Entries need
 * weighted agreement (or one very confident, well-scored voice) instead of
 * any single formula's whim.
 */
export function councilVote(members: Array<CouncilMember>, threshold = 0.6): CouncilVote {
  let net = 0
  let leadStrategyId: string | null = null
  let leadContribution = 0
  const reasons: Array<string> = []
  for (const m of members) {
    if (m.decision.signal === 'HOLD') continue
    const weight = strategyWeight(m.score) * m.decision.confidence
    const contribution = m.decision.signal === 'BUY' ? weight : -weight
    net += contribution
    reasons.push(`${m.strategyId}: ${m.decision.signal} (${m.decision.reason})`)
    if (Math.abs(contribution) > Math.abs(leadContribution)) {
      leadContribution = contribution
      leadStrategyId = m.strategyId
    }
  }
  let signal: Signal = 'HOLD'
  if (net >= threshold) signal = 'BUY'
  else if (net <= -threshold) signal = 'SELL'
  // The lead must agree with the direction the council settled on.
  if (signal === 'BUY' && leadContribution < 0) leadStrategyId = null
  if (signal === 'SELL' && leadContribution > 0) leadStrategyId = null
  return { signal, net, leadStrategyId, reasons }
}

/** Position size scaled by the lead strategy's track record. */
export function scaledQuoteSize(baseQuote: number, leadScore: number): number {
  return Math.round(baseQuote * strategyWeight(leadScore) * 100) / 100
}
