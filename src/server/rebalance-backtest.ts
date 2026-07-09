/**
 * Offline backtest for the fixed-weight rebalancing bot — mirrors
 * grid-backtest.ts's conventions (candle-close fills, per-side fees) and
 * reuses trading-backtest.ts's generic train/test and risk-adjusted-metrics
 * helpers. Reuses rebalance-engine.ts's pure planning functions
 * (planRebalance/buildTradePlan/maxDrift/equalTargetWeights) directly since
 * those are stateless math with zero execution coupling — unlike the
 * grid's live/offline pair, there's nothing here that needs a separate
 * reimplementation.
 */
import {
  buildTradePlan,
  equalTargetWeights,
  maxDrift,
  planRebalance,
} from './rebalance-engine'
import { computeRiskAdjustedMetrics } from './trading-backtest'
import type { RebalanceConfig } from './rebalance-engine'
import type { RiskAdjustedMetrics } from './trading-backtest'
import type { Candle } from './trading-strategies'

export interface RebalanceBacktestConfig {
  symbols: Array<string>
  targetWeights?: Record<string, number>
  driftThresholdPct: number
  minRebalanceIntervalMinutes: number
  feeRatePerSide: number
  startingBalanceQuote: number
}

export const DEFAULT_REBALANCE_BACKTEST_CONFIG: RebalanceBacktestConfig = {
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'],
  driftThresholdPct: 0.05,
  minRebalanceIntervalMinutes: 1440,
  feeRatePerSide: 0.001,
  startingBalanceQuote: 500,
}

export interface RebalanceBacktestTrade {
  symbol: string
  side: 'BUY' | 'SELL'
  notionalQuote: number
  price: number
  feeQuote: number
  reason: 'drift threshold' | 'scheduled interval'
  at: string
}

export interface RebalanceBacktestReport {
  config: RebalanceBacktestConfig
  symbols: Array<string>
  from: string
  to: string
  candleCount: number
  trades: Array<RebalanceBacktestTrade>
  rebalanceCount: number
  totalFeesQuote: number
  returnPct: number
  maxDrawdownPct: number
  finalEquityQuote: number
  buyAndHoldReturnPct: Record<string, number>
  equityCurve: Array<{ at: string; equity: number }>
  riskAdjusted: RiskAdjustedMetrics
}

export function runRebalanceBacktest(
  candlesBySymbol: Record<string, Array<Candle>>,
  config: RebalanceBacktestConfig,
): RebalanceBacktestReport {
  const symbols = config.symbols.filter((s) => candlesBySymbol[s].length > 0)
  const targetWeights = config.targetWeights ?? equalTargetWeights(symbols)

  const timeline = [
    ...new Set(symbols.flatMap((s) => candlesBySymbol[s].map((c) => c.openTime))),
  ].sort((a, b) => a - b)

  const priceIndex: Record<string, Map<number, number>> = {}
  for (const s of symbols) {
    priceIndex[s] = new Map(candlesBySymbol[s].map((c) => [c.openTime, c.close]))
  }

  const holdingsQty: Record<string, number> = Object.fromEntries(symbols.map((s) => [s, 0]))
  let quoteBalance = config.startingBalanceQuote
  const trades: Array<RebalanceBacktestTrade> = []
  let lastRebalanceAt: number | null = null
  let rebalanceCount = 0
  const equityCurve: Array<{ at: string; equity: number }> = []
  let peak = config.startingBalanceQuote
  let maxDrawdownPct = 0
  const lastPrice: Record<string, number | undefined> = {}

  const planConfig: RebalanceConfig = {
    // Offline replay only calls planRebalance/buildTradePlan (pure functions,
    // no live execution gate) — `enabled` is irrelevant here but required by
    // the type; true reflects "simulate as if armed."
    enabled: true,
    symbols,
    targetWeights,
    driftThresholdPct: config.driftThresholdPct,
    minRebalanceIntervalMinutes: config.minRebalanceIntervalMinutes,
    maxNotionalPerCycleQuote: Number.POSITIVE_INFINITY,
    minTradeNotionalQuote: 5,
  }

  for (const t of timeline) {
    for (const s of symbols) {
      const p = priceIndex[s].get(t)
      if (p != null) lastPrice[s] = p
    }
    // Wait until every symbol has at least one observed price.
    if (symbols.some((s) => lastPrice[s] == null)) continue
    // Verified complete above — safe to treat as fully populated from here.
    const knownPrice = lastPrice as Record<string, number>

    const holdingsValueQuote = Object.fromEntries(
      symbols.map((s) => [s, holdingsQty[s] * knownPrice[s]]),
    )
    const { items } = planRebalance(holdingsValueQuote, quoteBalance, targetWeights)
    const drift = maxDrift(items)
    const elapsedMinutes =
      lastRebalanceAt == null ? Number.POSITIVE_INFINITY : (t - lastRebalanceAt) / 60_000
    const timeTriggered = elapsedMinutes >= config.minRebalanceIntervalMinutes
    const driftTriggered = drift >= config.driftThresholdPct
    const triggered = lastRebalanceAt == null || timeTriggered || driftTriggered

    if (triggered) {
      const plan = buildTradePlan(items, planConfig)
      for (const p of plan) {
        const price = knownPrice[p.symbol]
        const fee = p.notionalQuote * config.feeRatePerSide
        if (p.side === 'BUY') {
          const spendable = Math.min(p.notionalQuote, quoteBalance)
          if (spendable < planConfig.minTradeNotionalQuote) continue
          const qty = (spendable - fee) / price
          holdingsQty[p.symbol] += qty
          quoteBalance -= spendable
        } else {
          const qty = p.notionalQuote / price
          if (qty > holdingsQty[p.symbol] + 1e-9) continue
          holdingsQty[p.symbol] -= qty
          quoteBalance += p.notionalQuote - fee
        }
        trades.push({
          symbol: p.symbol,
          side: p.side,
          notionalQuote: p.notionalQuote,
          price,
          feeQuote: fee,
          reason: driftTriggered ? 'drift threshold' : 'scheduled interval',
          at: new Date(t).toISOString(),
        })
      }
      lastRebalanceAt = t
      rebalanceCount++
    }

    // Equity/drawdown tracked every timeline step, not only on rebalance
    // events — otherwise drawdown between rebalances is invisible.
    const equity =
      quoteBalance + symbols.reduce((s, sym) => s + holdingsQty[sym] * knownPrice[sym], 0)
    equityCurve.push({ at: new Date(t).toISOString(), equity })
    peak = Math.max(peak, equity)
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown)
  }

  const finalEquityQuote =
    quoteBalance + symbols.reduce((s, sym) => s + holdingsQty[sym] * (lastPrice[sym] ?? 0), 0)
  const returnPct =
    config.startingBalanceQuote > 0
      ? ((finalEquityQuote - config.startingBalanceQuote) / config.startingBalanceQuote) * 100
      : 0
  const totalFeesQuote = trades.reduce((s, t) => s + t.feeQuote, 0)
  const buyAndHoldReturnPct: Record<string, number> = {}
  for (const s of symbols) {
    const series = candlesBySymbol[s]
    if (series.length > 1) {
      buyAndHoldReturnPct[s] =
        ((series[series.length - 1].close - series[0].close) / series[0].close) * 100
    }
  }

  return {
    config,
    symbols,
    from: timeline.length ? new Date(timeline[0]).toISOString() : '',
    to: timeline.length ? new Date(timeline[timeline.length - 1]).toISOString() : '',
    candleCount: timeline.length,
    trades,
    rebalanceCount,
    totalFeesQuote,
    returnPct,
    maxDrawdownPct,
    finalEquityQuote,
    buyAndHoldReturnPct,
    equityCurve,
    riskAdjusted: computeRiskAdjustedMetrics(equityCurve, returnPct, maxDrawdownPct),
  }
}
