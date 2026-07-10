import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BACKTEST_CONFIG,
  applyFillSlippage,
  buildWalkForwardWindows,
  computeRiskAdjustedMetrics,
  gapDownGuardTriggered,
  runBacktest,
  splitCandlesByIndex,
} from './trading-backtest'
import type { BacktestConfig } from './trading-backtest'
import type { Candle } from './trading-strategies'

const HOUR = 3_600_000
const T0 = Date.UTC(2026, 0, 1)

function candle(i: number, close: number, spreadPct = 0.002): Candle {
  const wick = close * spreadPct
  return {
    openTime: T0 + i * HOUR,
    open: close,
    high: close + wick,
    low: close - wick,
    close,
    volume: 100,
  }
}

/** Flat series, then a sharp sustained ramp that forces breakout/SMA BUYs. */
function rampSeries(n = 200): Array<Candle> {
  const out: Array<Candle> = []
  for (let i = 0; i < n; i++) {
    const base = 100
    const price =
      i < 120 ? base + Math.sin(i / 5) * 0.2 : base + (i - 120) * 1.5
    out.push(candle(i, price))
  }
  return out
}

/** Ramp up then crash — entries near the top get stopped out. */
function rampThenCrash(n = 220): Array<Candle> {
  const out: Array<Candle> = []
  for (let i = 0; i < n; i++) {
    const price =
      i < 120
        ? 100 + Math.sin(i / 5) * 0.2
        : i < 170
          ? 100 + (i - 120) * 1.5
          : 175 - (i - 170) * 3
    out.push(candle(i, Math.max(price, 10)))
  }
  return out
}

/** Flat series, then a sustained breakdown that forces breakout SELLs. */
function breakdownSeries(): Array<Candle> {
  return [
    ...Array.from({ length: 30 }, (_, i) => candle(i, 100)),
    candle(30, 95),
    candle(31, 90),
    candle(32, 88),
  ]
}

function marketRiskOffSeries(): Array<Candle> {
  return [
    ...Array.from({ length: 30 }, (_, i) => candle(i, 100)),
    candle(30, 80),
    candle(31, 80),
  ]
}

function marketRiskOnSeries(): Array<Candle> {
  return [
    ...Array.from({ length: 30 }, (_, i) => candle(i, 100)),
    candle(30, 120),
    candle(31, 120),
  ]
}

function longBreakoutSeries(): Array<Candle> {
  return [
    ...Array.from({ length: 30 }, (_, i) => candle(i, 100)),
    candle(30, 105),
    candle(31, 107),
  ]
}

/** Long high baseline, selloff, then a weak breakout still below the long SMA. */
function bearRegimeBreakout(): Array<Candle> {
  return [
    ...Array.from({ length: 60 }, (_, i) => candle(i, 100)),
    ...Array.from({ length: 30 }, (_, i) => candle(60 + i, 80)),
    candle(90, 82),
    candle(91, 83),
  ]
}

const config: BacktestConfig = { ...DEFAULT_BACKTEST_CONFIG }

function equityPoint(daysFromEpoch: number, equity: number) {
  return { at: new Date(Date.UTC(2026, 0, 1) + daysFromEpoch * 86_400_000).toISOString(), equity }
}

describe('computeRiskAdjustedMetrics', () => {
  it('returns all-null with fewer than 2 equity points', () => {
    const metrics = computeRiskAdjustedMetrics([equityPoint(0, 1000)], 0, 0)
    expect(metrics).toEqual({ sharpeRatio: null, calmarRatio: null, annualizedReturnPct: null })
  })

  it('treats a steady gain with zero volatility as Infinity, not null', () => {
    // Constant 1% *percentage* growth each step (geometric, not linear) —
    // this is what actually produces zero-variance period returns.
    const curve = Array.from({ length: 10 }, (_, i) => equityPoint(i, 1000 * 1.01 ** i))
    const metrics = computeRiskAdjustedMetrics(curve, 9, 0)
    expect(metrics.sharpeRatio).toBe(Infinity)
    expect(metrics.calmarRatio).toBe(Infinity)
  })

  it('returns null (not Infinity) for a flat equity curve with no return', () => {
    const curve = Array.from({ length: 10 }, (_, i) => equityPoint(i, 1000))
    const metrics = computeRiskAdjustedMetrics(curve, 0, 0)
    expect(metrics.sharpeRatio).toBeNull()
    expect(metrics.calmarRatio).toBeNull()
  })

  it('penalizes volatile returns relative to a smooth path with the same total return', () => {
    const smooth = Array.from({ length: 20 }, (_, i) => equityPoint(i, 1000 * (1 + i * 0.005)))
    // Same start/end equity as smooth, but oscillating in between.
    const volatile = [
      equityPoint(0, 1000),
      ...Array.from({ length: 18 }, (_, i) =>
        equityPoint(i + 1, 1000 * (1 + (i % 2 === 0 ? 0.05 : -0.02))),
      ),
      equityPoint(19, 1000 * (1 + 19 * 0.005)),
    ]
    const smoothMetrics = computeRiskAdjustedMetrics(smooth, 9.5, 0.1)
    const volatileMetrics = computeRiskAdjustedMetrics(volatile, 9.5, 5)
    expect(smoothMetrics.sharpeRatio).not.toBeNull()
    expect(volatileMetrics.sharpeRatio).not.toBeNull()
    expect(smoothMetrics.sharpeRatio as number).toBeGreaterThan(volatileMetrics.sharpeRatio as number)
  })

  it('annualizes a short window return, and Calmar divides by max drawdown', () => {
    // 10% return over 30 days ≈ annualized to roughly 10% × (365/30).
    const curve = [equityPoint(0, 1000), equityPoint(30, 1100)]
    const metrics = computeRiskAdjustedMetrics(curve, 10, 20)
    expect(metrics.annualizedReturnPct).not.toBeNull()
    expect(metrics.annualizedReturnPct as number).toBeCloseTo(10 * (365 / 30), 1)
    expect(metrics.calmarRatio).toBeCloseTo((metrics.annualizedReturnPct as number) / 20, 6)
  })
})

describe('runBacktest', () => {
  it('splits candle history by index for train/test diagnostics', () => {
    const split = splitCandlesByIndex({ BTCUSDT: rampSeries(10) }, 70)

    expect(split.train.BTCUSDT).toHaveLength(7)
    expect(split.test.BTCUSDT).toHaveLength(3)
    expect(split.test.BTCUSDT[0].openTime).toBe(T0 + 7 * HOUR)
  })

  it('builds anchored walk-forward windows without overlapping test folds', () => {
    const windows = buildWalkForwardWindows(
      {
        BTCUSDT: rampSeries(100),
        ETHUSDT: rampSeries(80),
      },
      60,
      4,
    )

    expect(windows).toHaveLength(4)
    expect(windows.map((w) => w.testStartPct)).toEqual([60, 70, 80, 90])
    expect(windows.map((w) => w.testEndPct)).toEqual([70, 80, 90, 100])
    expect(windows.map((w) => w.train.BTCUSDT.length)).toEqual([60, 70, 80, 90])
    expect(windows.map((w) => w.test.BTCUSDT.length)).toEqual([10, 10, 10, 10])
    expect(windows.map((w) => w.train.ETHUSDT.length)).toEqual([48, 56, 64, 72])
    expect(windows.map((w) => w.test.ETHUSDT.length)).toEqual([8, 8, 8, 8])
    expect(windows[1].test.BTCUSDT[0].openTime).toBe(T0 + 70 * HOUR)
  })

  it('rejects walk-forward fold counts that leave empty test folds', () => {
    expect(() =>
      buildWalkForwardWindows({ BTCUSDT: rampSeries(10) }, 80, 3),
    ).toThrow(/out-of-sample candles/)
  })

  it('opens and closes trades on a trending series and realizes everything', () => {
    const report = runBacktest({ BTCUSDT: rampSeries() }, '1h', config)
    expect(report.trades.length).toBeGreaterThan(0)
    // Every position is realized by the end — final equity is pure quote.
    const pnl = report.trades.reduce((s, t) => s + t.pnlQuote, 0)
    expect(report.finalEquityQuote).toBeCloseTo(
      config.startingBalanceQuote + pnl,
      6,
    )
    expect(report.totalPnlQuote).toBeCloseTo(pnl, 10)
  })

  it('is deterministic for the same inputs', () => {
    const a = runBacktest({ BTCUSDT: rampSeries() }, '1h', config)
    const b = runBacktest({ BTCUSDT: rampSeries() }, '1h', config)
    expect(a.totalPnlQuote).toBe(b.totalPnlQuote)
    expect(a.trades.length).toBe(b.trades.length)
    expect(a.maxDrawdownPct).toBe(b.maxDrawdownPct)
  })

  it('charges the configured fee on both sides of every round trip', () => {
    const report = runBacktest({ BTCUSDT: rampSeries() }, '1h', config)
    for (const t of report.trades) {
      const expectedEntryFee = t.entryQuote * config.feeRatePerSide
      const expectedExitFee = t.exitQuote * config.feeRatePerSide
      expect(t.feesQuote).toBeCloseTo(expectedEntryFee + expectedExitFee, 8)
      expect(t.pnlQuote).toBeCloseTo(
        t.exitQuote - t.entryQuote - t.feesQuote,
        8,
      )
    }
  })

  it('zero-fee run matches paper-mode accounting (fees = 0)', () => {
    const report = runBacktest({ BTCUSDT: rampSeries() }, '1h', {
      ...config,
      feeRatePerSide: 0,
    })
    expect(report.totalFeesQuote).toBe(0)
  })

  it('stops out losing entries and records the stop-loss reason', () => {
    // Breakout alone so the ramp guarantees an open position when the crash
    // hits — with the full council, RSI's overbought SELL vote hedges the
    // breakout BUY during a steady ramp and no position straddles the top.
    const report = runBacktest({ BTCUSDT: rampThenCrash() }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
    })
    const stops = report.trades.filter((t) => t.reason.startsWith('stop-loss'))
    expect(stops.length).toBeGreaterThan(0)
    for (const t of stops) expect(t.pnlQuote).toBeLessThan(0)
  })

  it('trailing stop lets winners run past the fixed take-profit and exits off the peak', () => {
    const fixed = runBacktest({ BTCUSDT: rampThenCrash() }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
    })
    const trailed = runBacktest({ BTCUSDT: rampThenCrash() }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      trailingStopPct: 0.02,
    })
    const trailExits = trailed.trades.filter((t) =>
      t.reason.startsWith('trailing-stop'),
    )
    expect(trailExits.length).toBeGreaterThan(0)
    // Trailing mode replaces the fixed TP entirely.
    expect(trailed.trades.some((t) => t.reason.startsWith('take-profit'))).toBe(
      false,
    )
    // The best trailed winner rides further than the 3% fixed cap allows.
    const bestTrailPct = Math.max(
      ...trailExits.map((t) => (t.exitPrice - t.entryPrice) / t.entryPrice),
    )
    expect(bestTrailPct).toBeGreaterThan(config.takeProfitPct)
    const bestFixedPct = Math.max(
      ...fixed.trades.map((t) => (t.exitPrice - t.entryPrice) / t.entryPrice),
    )
    expect(bestTrailPct).toBeGreaterThan(bestFixedPct)
  })

  it('trailing stop still honors the hard stop-loss from entry', () => {
    // Breakout candle then an immediate reversal: price never rises after
    // entry, so a loose 10% trail can't fire before the 2% hard stop does.
    const failedBreakout = [
      ...Array.from({ length: 30 }, (_, i) => candle(i, 100)),
      candle(30, 106),
      candle(31, 103),
      candle(32, 100),
      candle(33, 97),
    ]
    const report = runBacktest({ BTCUSDT: failedBreakout }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      trailingStopPct: 0.1,
    })
    expect(report.trades.some((t) => t.reason.startsWith('stop-loss'))).toBe(
      true,
    )
    expect(
      report.trades.some((t) => t.reason.startsWith('trailing-stop')),
    ).toBe(false)
  })

  it('keeps the default backtest direction long-only', () => {
    const report = runBacktest({ BTCUSDT: breakdownSeries() }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
    })

    expect(report.config.tradeDirection).toBe('long')
    expect(report.trades).toHaveLength(0)
  })

  it('can open and profit from short entries in offline research mode', () => {
    const report = runBacktest({ BTCUSDT: breakdownSeries() }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      tradeDirection: 'short',
      takeProfitPct: 0.03,
    })

    expect(report.trades.length).toBeGreaterThan(0)
    expect(report.trades.every((t) => t.side === 'short')).toBe(true)
    expect(report.trades.some((t) => t.reason.startsWith('take-profit'))).toBe(
      true,
    )
    expect(report.trades.some((t) => t.pnlQuote > 0)).toBe(true)
    expect(report.trades.some((t) => t.exitQuote < t.entryQuote)).toBe(true)
  })

  it('stops out short entries when price rises against them', () => {
    const failedBreakdown = [
      ...Array.from({ length: 30 }, (_, i) => candle(i, 100)),
      candle(30, 95),
      candle(31, 98),
    ]
    const report = runBacktest({ BTCUSDT: failedBreakdown }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      tradeDirection: 'short',
      stopLossPct: 0.02,
      takeProfitPct: 0.2,
    })

    const stopped = report.trades.filter((t) =>
      t.reason.startsWith('stop-loss'),
    )
    expect(stopped.length).toBeGreaterThan(0)
    expect(stopped.every((t) => t.side === 'short')).toBe(true)
    expect(stopped.every((t) => t.pnlQuote < 0)).toBe(true)
  })

  it('can use an ATR take-profit target instead of the fixed percent target', () => {
    const series = [
      ...Array.from({ length: 30 }, (_, i) => candle(i, 100)),
      candle(30, 102),
      candle(31, 102.6),
      candle(32, 103),
    ]
    const report = runBacktest({ BTCUSDT: series }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      takeProfitPct: 0.1,
      atrPeriod: 5,
      atrTakeProfitMultiple: 1,
    })

    expect(report.trades.some((t) => t.reason.startsWith('atr-target'))).toBe(
      true,
    )
    expect(report.trades.some((t) => t.reason.startsWith('take-profit'))).toBe(
      false,
    )
  })

  it('can use an ATR take-profit target below a short entry', () => {
    const series = [
      ...Array.from({ length: 30 }, (_, i) => candle(i, 100)),
      candle(30, 98),
      candle(31, 96),
    ]
    const report = runBacktest({ BTCUSDT: series }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      tradeDirection: 'short',
      takeProfitPct: 0.2,
      atrPeriod: 5,
      atrTakeProfitMultiple: 1,
    })

    expect(report.trades.some((t) => t.reason.startsWith('atr-target'))).toBe(
      true,
    )
    expect(report.trades.some((t) => t.side === 'short')).toBe(true)
  })

  it('can use an ATR stop before the fixed percent stop is reached', () => {
    const series = [
      ...Array.from({ length: 30 }, (_, i) => candle(i, 100)),
      candle(30, 102),
      candle(31, 101.1),
    ]
    const report = runBacktest({ BTCUSDT: series }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      stopLossPct: 0.05,
      atrPeriod: 5,
      atrStopMultiple: 1,
    })

    expect(report.trades.some((t) => t.reason.startsWith('atr-stop'))).toBe(
      true,
    )
    expect(report.trades.some((t) => t.reason.startsWith('stop-loss'))).toBe(
      false,
    )
  })

  it('can trail winners by an ATR distance from the high-water close', () => {
    const series = [
      ...Array.from({ length: 30 }, (_, i) => candle(i, 100)),
      candle(30, 102),
      candle(31, 105),
      candle(32, 104),
    ]
    const report = runBacktest({ BTCUSDT: series }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      takeProfitPct: 0.01,
      atrPeriod: 5,
      atrTrailingMultiple: 1,
    })

    expect(
      report.trades.some((t) => t.reason.startsWith('atr-trailing-stop')),
    ).toBe(true)
    expect(report.trades.some((t) => t.reason.startsWith('take-profit'))).toBe(
      false,
    )
  })

  it('respects the guardian balance floor', () => {
    const tiny = {
      ...config,
      startingBalanceQuote: 510,
      guardian: { ...config.guardian, minQuoteBalance: 500 },
    }
    const report = runBacktest({ BTCUSDT: rampSeries() }, '1h', tiny)
    // 510 − 500 floor leaves <25 to spend → every entry is blocked.
    expect(report.trades.length).toBe(0)
    expect(report.guardianBlocks.balance_floor ?? 0).toBeGreaterThan(0)
  })

  it('can block long entries below the configured regime SMA', () => {
    const series = bearRegimeBreakout()
    const ungated = runBacktest({ BTCUSDT: series }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      regimeSmaPeriod: 0,
    })
    const gated = runBacktest({ BTCUSDT: series }, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      regimeSmaPeriod: 50,
    })

    expect(ungated.trades.length).toBeGreaterThan(0)
    expect(gated.trades.length).toBe(0)
    expect(gated.guardianBlocks.regime_below_long_sma ?? 0).toBeGreaterThan(0)
  })

  it('can block long entries when the benchmark market is below its SMA', () => {
    const ungated = runBacktest(
      {
        BTCUSDT: marketRiskOffSeries(),
        ETHUSDT: longBreakoutSeries(),
      },
      '1h',
      {
        ...config,
        enabledStrategies: ['breakout'],
      },
    )
    const gated = runBacktest(
      {
        BTCUSDT: marketRiskOffSeries(),
        ETHUSDT: longBreakoutSeries(),
      },
      '1h',
      {
        ...config,
        enabledStrategies: ['breakout'],
        marketRegimeSymbol: 'BTCUSDT',
        marketRegimeSmaPeriod: 20,
      },
    )

    expect(ungated.trades.some((t) => t.symbol === 'ETHUSDT')).toBe(true)
    expect(gated.trades.some((t) => t.symbol === 'ETHUSDT')).toBe(false)
    expect(gated.guardianBlocks.market_regime_below_sma ?? 0).toBeGreaterThan(0)
  })

  it('can block short entries when the benchmark market is above its SMA', () => {
    const ungated = runBacktest(
      {
        BTCUSDT: marketRiskOnSeries(),
        ETHUSDT: breakdownSeries(),
      },
      '1h',
      {
        ...config,
        enabledStrategies: ['breakout'],
        tradeDirection: 'short',
      },
    )
    const gated = runBacktest(
      {
        BTCUSDT: marketRiskOnSeries(),
        ETHUSDT: breakdownSeries(),
      },
      '1h',
      {
        ...config,
        enabledStrategies: ['breakout'],
        tradeDirection: 'short',
        marketRegimeSymbol: 'BTCUSDT',
        marketRegimeSmaPeriod: 20,
      },
    )

    expect(ungated.trades.some((t) => t.symbol === 'ETHUSDT')).toBe(true)
    expect(gated.trades.some((t) => t.symbol === 'ETHUSDT')).toBe(false)
    expect(gated.guardianBlocks.market_regime_above_sma ?? 0).toBeGreaterThan(0)
  })

  it('never holds more than one position per symbol', () => {
    // Reconstruct open-position intervals from the trade log: for a single
    // symbol, entries must never overlap.
    const report = runBacktest({ BTCUSDT: rampSeries() }, '1h', config)
    const intervals = report.trades
      .map((t) => [Date.parse(t.openedAt), Date.parse(t.closedAt)] as const)
      .sort((a, b) => a[0] - b[0])
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i][0]).toBeGreaterThanOrEqual(intervals[i - 1][1])
    }
  })

  it('computes buy-and-hold benchmark per symbol', () => {
    const series = rampSeries()
    const report = runBacktest({ BTCUSDT: series }, '1h', config)
    const expected =
      ((series[series.length - 1].close - series[0].close) / series[0].close) *
      100
    expect(report.buyAndHoldReturnPct.BTCUSDT).toBeCloseTo(expected, 8)
  })

  it('handles multi-symbol runs on a shared timeline', () => {
    const report = runBacktest(
      { BTCUSDT: rampSeries(), ETHUSDT: rampThenCrash() },
      '1h',
      config,
    )
    expect(report.symbols).toEqual(['BTCUSDT', 'ETHUSDT'])
    expect(report.equityCurve.length).toBeGreaterThan(0)
    // Equity curve timestamps are strictly increasing.
    for (let i = 1; i < report.equityCurve.length; i++) {
      expect(Date.parse(report.equityCurve[i].at)).toBeGreaterThan(
        Date.parse(report.equityCurve[i - 1].at),
      )
    }
  })

  it('can keep strategy scores scoped per symbol for research', () => {
    const candlesBySymbol = {
      BTCUSDT: rampSeries(),
      ETHUSDT: rampThenCrash(),
    }
    const global = runBacktest(candlesBySymbol, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      scoreScope: 'global',
    })
    const perSymbol = runBacktest(candlesBySymbol, '1h', {
      ...config,
      enabledStrategies: ['breakout'],
      scoreScope: 'per_symbol',
    })

    expect(global.strategyReports).toHaveLength(1)
    expect(global.strategyReports[0].symbol).toBeUndefined()
    expect(perSymbol.strategyReports.map((r) => r.symbol).sort()).toEqual([
      'BTCUSDT',
      'ETHUSDT',
    ])
  })

  it('can seed a later run with trained strategy score state', () => {
    const strategyConfig = { ...config, enabledStrategies: ['breakout'] }
    const train = runBacktest({ BTCUSDT: rampSeries() }, '1h', strategyConfig)
    const fresh = runBacktest({ BTCUSDT: rampSeries() }, '1h', strategyConfig)
    const carried = runBacktest(
      { BTCUSDT: rampSeries() },
      '1h',
      strategyConfig,
      { initialScores: train.scoreState },
    )

    expect(train.scoreState.breakout.score).toBeGreaterThan(0)
    expect(fresh.trades.length).toBeGreaterThan(0)
    expect(carried.trades.length).toBeGreaterThan(0)
    expect(carried.trades[0].entryQuote).toBeGreaterThan(
      fresh.trades[0].entryQuote,
    )
  })
})

describe('applyFillSlippage', () => {
  it('is a no-op at 0 bps', () => {
    expect(applyFillSlippage(100, 'buy', 0)).toBe(100)
    expect(applyFillSlippage(100, 'sell', 0)).toBe(100)
  })

  it('fills buys worse (higher) and sells worse (lower)', () => {
    expect(applyFillSlippage(100, 'buy', 50)).toBeCloseTo(100.5, 8)
    expect(applyFillSlippage(100, 'sell', 50)).toBeCloseTo(99.5, 8)
  })
})

describe('gapDownGuardTriggered', () => {
  it('is off at 0 pct regardless of gap size', () => {
    expect(gapDownGuardTriggered(80, 100, 0)).toBe(false)
  })

  it('does not trigger without a prior close to compare against', () => {
    expect(gapDownGuardTriggered(80, undefined, 0.07)).toBe(false)
  })

  it('triggers only once the gap exceeds the threshold', () => {
    expect(gapDownGuardTriggered(96, 100, 0.07)).toBe(false) // 4% gap
    expect(gapDownGuardTriggered(90, 100, 0.07)).toBe(true) // 10% gap
  })
})

describe('backtest slippage + gap-down guard integration', () => {
  /** 25 flat warmup candles, then one breakout bar whose OPEN can be gapped independently of its close. */
  function breakoutSeriesWithGap(gapOpen: number): Array<Candle> {
    const flat = Array.from({ length: 25 }, (_, i) => candle(i, 100))
    const breakoutBar: Candle = {
      openTime: T0 + 25 * HOUR,
      open: gapOpen,
      high: 115,
      low: Math.min(gapOpen, 99) - 1,
      close: 112,
      volume: 100,
    }
    return [...flat, breakoutBar]
  }

  const breakoutOnly: BacktestConfig = { ...config, enabledStrategies: ['breakout'] }

  it('applies slippage to both entry and exit fills, reducing pnl vs an unslipped run', () => {
    // A series that ends right on the breakout bar opens exactly one trade,
    // immediately realized at "end of backtest" on the same close (fills use
    // candle.close, not open) — this isolates the fill-price effect from any
    // knock-on change to exit timing (anchoring stops/targets to the real
    // fill price, as this phase intentionally does, can otherwise shift when
    // later trades open/close).
    const series = breakoutSeriesWithGap(100)
    const baseline = runBacktest({ BTCUSDT: series }, '1h', breakoutOnly)
    const slipped = runBacktest({ BTCUSDT: series }, '1h', {
      ...breakoutOnly,
      slippageBps: 50,
    })
    expect(baseline.trades).toHaveLength(1)
    expect(slipped.trades).toHaveLength(1)
    expect(slipped.trades[0].entryPrice).toBeCloseTo(applyFillSlippage(112, 'buy', 50), 8)
    expect(slipped.trades[0].exitPrice).toBeCloseTo(applyFillSlippage(112, 'sell', 50), 8)
    expect(slipped.trades[0].entryPrice).toBeGreaterThan(baseline.trades[0].entryPrice)
    expect(slipped.trades[0].exitPrice).toBeLessThan(baseline.trades[0].exitPrice)
    expect(slipped.totalPnlQuote).toBeLessThan(baseline.totalPnlQuote)
  })

  it('blocks a new entry on a bar that gapped down past the guard threshold', () => {
    const report = runBacktest({ BTCUSDT: breakoutSeriesWithGap(90) }, '1h', {
      ...breakoutOnly,
      gapDownGuardPct: 0.07, // prior close 100 -> 10% gap trips it
    })
    expect(report.trades.length).toBe(0)
    expect(report.guardianBlocks.gap_down_guard).toBeGreaterThan(0)
  })

  it('still opens the same entry when the guard is off (default) despite the gap', () => {
    const report = runBacktest({ BTCUSDT: breakoutSeriesWithGap(90) }, '1h', breakoutOnly)
    expect(report.trades.length + 1).toBeGreaterThan(1) // opened (may still be open at report end, realized on close-out)
    expect(report.guardianBlocks.gap_down_guard ?? 0).toBe(0)
  })

  it('never blocks an exit — an existing position still stops out on a gapped-down bar', () => {
    const flat = Array.from({ length: 25 }, (_, i) => candle(i, 100))
    const openBar: Candle = { openTime: T0 + 25 * HOUR, open: 100, high: 115, low: 99, close: 112, volume: 100 }
    // Gaps down ~20% from the prior close (112) and breaches the 2% stop-loss.
    const crashBar: Candle = { openTime: T0 + 26 * HOUR, open: 90, high: 91, low: 84, close: 85, volume: 100 }
    const report = runBacktest({ BTCUSDT: [...flat, openBar, crashBar] }, '1h', {
      ...breakoutOnly,
      gapDownGuardPct: 0.07,
    })
    const stops = report.trades.filter((t) => t.reason.startsWith('stop-loss'))
    expect(stops.length).toBeGreaterThan(0)
  })
})

describe('backtest ATR position sizing', () => {
  it('is a no-op at the default (0 = off)', () => {
    const withField: BacktestConfig = { ...config, atrSizeBaselinePct: 0 }
    const a = runBacktest({ BTCUSDT: rampSeries() }, '1h', config)
    const b = runBacktest({ BTCUSDT: rampSeries() }, '1h', withField)
    expect(b.trades.map((t) => t.entryQuote)).toEqual(a.trades.map((t) => t.entryQuote))
  })

  it('shrinks entry size when the baseline is set far below actual volatility', () => {
    const baseline = runBacktest({ BTCUSDT: rampSeries() }, '1h', config)
    const shrunk = runBacktest({ BTCUSDT: rampSeries() }, '1h', {
      ...config,
      atrSizeBaselinePct: 0.0005, // ramp's real ATR/price is far above this -> floors
      atrSizeMinMultiplier: 0.25,
    })
    expect(baseline.trades.length).toBeGreaterThan(0)
    expect(shrunk.trades.length).toBeGreaterThan(0)
    expect(shrunk.trades[0].entryQuote).toBeCloseTo(baseline.trades[0].entryQuote * 0.25, 6)
  })
})

describe('backtest ADX trend-strength gate', () => {
  it('is a no-op at the default (adxThreshold: 0)', () => {
    const a = runBacktest({ BTCUSDT: rampSeries() }, '1h', config)
    const b = runBacktest({ BTCUSDT: rampSeries() }, '1h', { ...config, adxThreshold: 0 })
    expect(b.trades.map((t) => t.entryPrice)).toEqual(a.trades.map((t) => t.entryPrice))
  })

  it('blocks every entry when the threshold is set above any real ADX value', () => {
    const baseline = runBacktest({ BTCUSDT: rampSeries() }, '1h', config)
    const blocked = runBacktest({ BTCUSDT: rampSeries() }, '1h', { ...config, adxThreshold: 999 })
    expect(baseline.trades.length).toBeGreaterThan(0)
    expect(blocked.trades.length).toBe(0)
    expect(blocked.guardianBlocks.adx_trend_weak).toBeGreaterThan(0)
  })
})

describe('backtest Fibonacci-extension take-profit', () => {
  it('is a no-op at the default (fibTakeProfitEnabled: false)', () => {
    const a = runBacktest({ BTCUSDT: rampSeries() }, '1h', config)
    const b = runBacktest({ BTCUSDT: rampSeries() }, '1h', { ...config, fibTakeProfitEnabled: false })
    expect(b.trades.map((t) => t.entryPrice)).toEqual(a.trades.map((t) => t.entryPrice))
  })

  it('exits at a fib-target when enabled with a tight extension ratio', () => {
    const report = runBacktest({ BTCUSDT: rampSeries() }, '1h', {
      ...config,
      fibTakeProfitEnabled: true,
      fibSwingLookback: 20,
      fibExtensionRatio: 0.05, // tight enough that the sustained ramp clears it quickly
    })
    expect(report.trades.some((t) => t.reason.startsWith('fib-target'))).toBe(true)
  })
})
