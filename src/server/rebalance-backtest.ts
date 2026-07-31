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
  // See docs/tsconfig-strictness-rollout.md — `?? []` treats a symbol with
  // no candlesBySymbol entry the same as one with zero candles (filtered
  // out below), rather than crashing on a missing key. This is at least as
  // safe as the original `candlesBySymbol[s].length > 0` (which would have
  // thrown for a caller-supplied config.symbols entry not present in
  // candlesBySymbol at all), never less safe.
  const symbols = config.symbols.filter(
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    (s) => (candlesBySymbol[s]?.length ?? 0) > 0,
  )
  const targetWeights = config.targetWeights ?? equalTargetWeights(symbols)

  // `symbols` is now filtered down to only keys present in candlesBySymbol
  // (see above), so every lookup below is safe; restructured via
  // Object.entries/Object.values where it doesn't need the filtered
  // `symbols` list itself, to avoid a redundant indexed-access guard.
  const timeline = [
    ...new Set(
      symbols.flatMap(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        (s) => candlesBySymbol[s]?.map((c) => c.openTime) ?? [],
      ),
    ),
  ].sort((a, b) => a - b)

  const priceIndex: Record<string, Map<number, number>> = {}
  for (const s of symbols) {
    const candles = candlesBySymbol[s]
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (candles === undefined) continue
    priceIndex[s] = new Map(candles.map((c) => [c.openTime, c.close]))
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
      // See docs/tsconfig-strictness-rollout.md — priceIndex/holdingsQty
      // were populated for every symbol in this same `symbols` array above.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      const p = priceIndex[s]?.get(t)
      if (p != null) lastPrice[s] = p
    }
    // Wait until every symbol has at least one observed price.
    if (symbols.some((s) => lastPrice[s] == null)) continue
    // Verified complete above — every symbol has a real price from here on;
    // rebuilt as a plain Record<string, number> (values only, via `?? 0`
    // fallbacks that the `.some()` check above proves are never actually
    // hit) rather than an `as` cast, since a cast doesn't stop
    // noUncheckedIndexedAccess from re-flagging later indexed reads into it.
    const knownPrice: Record<string, number> = Object.fromEntries(
      symbols.map((s) => [s, lastPrice[s] ?? 0]),
    )

    const holdingsValueQuote = Object.fromEntries(
      symbols.map((s) => [s, (holdingsQty[s] ?? 0) * (knownPrice[s] ?? 0)]),
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
        const heldQty = holdingsQty[p.symbol]
        // buildTradePlan only ever proposes trades for symbols present in
        // `items`/`targetWeights`, both scoped to `symbols` above — real
        // guard anyway (not a suppression) since this affects trade math:
        // skip rather than risk executing with a wrong/zero price.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        if (price === undefined || heldQty === undefined) continue
        const fee = p.notionalQuote * config.feeRatePerSide
        if (p.side === 'BUY') {
          const spendable = Math.min(p.notionalQuote, quoteBalance)
          if (spendable < planConfig.minTradeNotionalQuote) continue
          const qty = (spendable - fee) / price
          holdingsQty[p.symbol] = heldQty + qty
          quoteBalance -= spendable
        } else {
          const qty = p.notionalQuote / price
          if (qty > heldQty + 1e-9) continue
          holdingsQty[p.symbol] = heldQty - qty
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
      quoteBalance +
      symbols.reduce(
        (s, sym) => s + (holdingsQty[sym] ?? 0) * (knownPrice[sym] ?? 0),
        0,
      )
    equityCurve.push({ at: new Date(t).toISOString(), equity })
    peak = Math.max(peak, equity)
    const drawdown = peak > 0 ? ((peak - equity) / peak) * 100 : 0
    maxDrawdownPct = Math.max(maxDrawdownPct, drawdown)
  }

  const finalEquityQuote =
    quoteBalance +
    symbols.reduce(
      (s, sym) => s + (holdingsQty[sym] ?? 0) * (lastPrice[sym] ?? 0),
      0,
    )
  const returnPct =
    config.startingBalanceQuote > 0
      ? ((finalEquityQuote - config.startingBalanceQuote) / config.startingBalanceQuote) * 100
      : 0
  const totalFeesQuote = trades.reduce((s, t) => s + t.feeQuote, 0)
  const buyAndHoldReturnPct: Record<string, number> = {}
  for (const s of symbols) {
    const series = candlesBySymbol[s]
    // See docs/tsconfig-strictness-rollout.md — `symbols` is filtered to
    // only keys present (with candles) in candlesBySymbol above.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (series === undefined) continue
    if (series.length > 1) {
      const firstCandle = series[0]
      const lastCandle = series[series.length - 1]
      // See docs/tsconfig-strictness-rollout.md — series.length > 1 is
      // already checked above.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (firstCandle === undefined || lastCandle === undefined) continue
      buyAndHoldReturnPct[s] =
        ((lastCandle.close - firstCandle.close) / firstCandle.close) * 100
    }
  }

  const firstOpenTime = timeline[0]
  const lastOpenTime = timeline[timeline.length - 1]
  return {
    config,
    symbols,
    // See docs/tsconfig-strictness-rollout.md — `timeline.length` is
    // already checked in the ternary, so a defined index is guaranteed on
    // the truthy branch; `?? 0` is unreachable there, only relevant to the
    // (never taken) empty-timeline branch's own fallback.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    from: timeline.length ? new Date(firstOpenTime ?? 0).toISOString() : '',
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    to: timeline.length ? new Date(lastOpenTime ?? 0).toISOString() : '',
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
