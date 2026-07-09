import { describe, expect, it } from 'vitest'
import { DEFAULT_REBALANCE_BACKTEST_CONFIG, runRebalanceBacktest } from './rebalance-backtest'
import type { RebalanceBacktestConfig } from './rebalance-backtest'
import type { Candle } from './trading-strategies'

const HOUR = 60 * 60_000
const BASE = Date.parse('2026-01-01T00:00:00.000Z')

function candle(index: number, close: number): Candle {
  return {
    openTime: BASE + index * HOUR,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1,
  }
}

function cfg(overrides: Partial<RebalanceBacktestConfig> = {}): RebalanceBacktestConfig {
  return { ...DEFAULT_REBALANCE_BACKTEST_CONFIG, ...overrides }
}

describe('runRebalanceBacktest', () => {
  it('allocates the full starting balance across symbols on the first rebalance, net of fees', () => {
    const candlesBySymbol = {
      A: [candle(0, 100)],
      B: [candle(0, 100)],
    }
    const report = runRebalanceBacktest(
      candlesBySymbol,
      cfg({ symbols: ['A', 'B'], startingBalanceQuote: 500, feeRatePerSide: 0.001 }),
    )
    expect(report.rebalanceCount).toBe(1)
    expect(report.trades).toHaveLength(2)
    expect(report.trades.every((t) => t.side === 'BUY')).toBe(true)
    // 500 split 50/50 minus 2 x 0.1% fees on 250 each = 500 - 0.5 = 499.5
    expect(report.finalEquityQuote).toBeCloseTo(499.5, 6)
  })

  it('does not re-trade when nothing has drifted and the interval has not elapsed', () => {
    const candlesBySymbol = {
      A: [candle(0, 100), candle(1, 100), candle(2, 100)],
      B: [candle(0, 100), candle(1, 100), candle(2, 100)],
    }
    const report = runRebalanceBacktest(
      candlesBySymbol,
      cfg({ symbols: ['A', 'B'], startingBalanceQuote: 500, minRebalanceIntervalMinutes: 1440 }),
    )
    expect(report.rebalanceCount).toBe(1) // only the initial allocation
  })

  it('rebalances early on a large drift even before the scheduled interval elapses', () => {
    const candlesBySymbol = {
      A: [candle(0, 100), candle(1, 100), candle(2, 300)], // A triples — big drift
      B: [candle(0, 100), candle(1, 100), candle(2, 100)],
    }
    const report = runRebalanceBacktest(
      candlesBySymbol,
      cfg({
        symbols: ['A', 'B'],
        startingBalanceQuote: 500,
        driftThresholdPct: 0.05,
        minRebalanceIntervalMinutes: 1440, // a full day — should NOT be reached in 2 hours
      }),
    )
    expect(report.rebalanceCount).toBe(2) // initial allocation + one drift-triggered rebalance
    expect(report.trades.some((t) => t.reason === 'drift threshold')).toBe(true)
  })

  it('reports a buy-and-hold comparison per symbol', () => {
    const candlesBySymbol = {
      A: [candle(0, 100), candle(1, 110)],
      B: [candle(0, 100), candle(1, 90)],
    }
    const report = runRebalanceBacktest(candlesBySymbol, cfg({ symbols: ['A', 'B'] }))
    expect(report.buyAndHoldReturnPct.A).toBeCloseTo(10, 6)
    expect(report.buyAndHoldReturnPct.B).toBeCloseTo(-10, 6)
  })
})
