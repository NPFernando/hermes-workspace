import { describe, expect, it } from 'vitest'

import {
  applyTradeOutcome,
  breakoutStrategy,
  councilVote,
  ema,
  emptyScore,
  macdMomentumStrategy,
  rsi,
  rsiReversionStrategy,
  scaledQuoteSize,
  sma,
  smaCrossoverStrategy,
  type Candle,
} from './trading-strategies'

const candlesFromCloses = (closes: Array<number>): Array<Candle> =>
  closes.map((c, i) => ({ openTime: i, open: c, high: c, low: c, close: c, volume: 1 }))

describe('indicators', () => {
  it('sma averages the trailing window', () => {
    expect(sma([1, 2, 3, 4], 2)).toBe(3.5)
    expect(sma([1, 2], 3)).toBeNull()
  })

  it('rsi is 100 when only gains', () => {
    expect(rsi([1, 2, 3, 4, 5, 6], 5)).toBe(100)
  })
})

describe('smaCrossoverStrategy', () => {
  it('signals BUY when the fast SMA crosses above the slow SMA', () => {
    // long downtrend then a sharp reversal so fast crosses above slow on the last candle
    const closes = [
      ...Array.from({ length: 20 }, (_, i) => 100 - i),
      120, // spike up
    ]
    const d = smaCrossoverStrategy.evaluate(candlesFromCloses(closes), { fast: 3, slow: 8 })
    expect(d.signal).toBe('BUY')
    expect(d.confidence).toBeGreaterThan(0)
  })

  it('holds without enough candles', () => {
    expect(smaCrossoverStrategy.evaluate(candlesFromCloses([1, 2, 3])).signal).toBe('HOLD')
  })
})

describe('rsiReversionStrategy', () => {
  it('signals BUY when oversold', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i * 2) // steady decline
    const d = rsiReversionStrategy.evaluate(candlesFromCloses(closes), { period: 14 })
    expect(d.signal).toBe('BUY')
  })

  it('signals SELL when overbought', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i * 2) // steady rise
    const d = rsiReversionStrategy.evaluate(candlesFromCloses(closes), { period: 14 })
    expect(d.signal).toBe('SELL')
  })
})

describe('applyTradeOutcome scoring', () => {
  it('rewards profit and counts a win', () => {
    const s = applyTradeOutcome(emptyScore('x'), 10, 100)
    expect(s.wins).toBe(1)
    expect(s.losses).toBe(0)
    expect(s.score).toBeGreaterThan(0)
    expect(s.totalPnlQuote).toBe(10)
    expect(s.winRate).toBe(1)
  })

  it('penalizes loss and counts a loss', () => {
    const s = applyTradeOutcome(emptyScore('x'), -10, 100)
    expect(s.losses).toBe(1)
    expect(s.score).toBeLessThan(0)
  })

  it('accumulates across trades and clamps outliers', () => {
    let s = emptyScore('x')
    s = applyTradeOutcome(s, 5, 100) // +0.5
    s = applyTradeOutcome(s, -2, 100) // -0.2
    s = applyTradeOutcome(s, 9999, 100) // clamped to +1, not +999
    expect(s.trades).toBe(3)
    expect(s.wins).toBe(2)
    expect(s.score).toBeLessThanOrEqual(1.5 + 1e-9)
    expect(s.score).toBeCloseTo(0.5 - 0.2 + 1, 5)
  })
})

describe('new strategies', () => {
  it('macd momentum emits a decision on a long series', () => {
    const closes = [
      ...Array.from({ length: 30 }, (_, i) => 100 - i * 0.5),
      ...Array.from({ length: 20 }, (_, i) => 85 + i * 1.5),
    ]
    const d = macdMomentumStrategy.evaluate(candlesFromCloses(closes))
    expect(['BUY', 'SELL', 'HOLD']).toContain(d.signal)
  })

  it('breakout signals BUY when price breaks the prior high', () => {
    const closes = [...Array.from({ length: 21 }, () => 100), 110]
    const candles = closes.map((c, i) => ({ openTime: i, open: c, high: c, low: c, close: c, volume: 1 }))
    expect(breakoutStrategy.evaluate(candles, { lookback: 20 }).signal).toBe('BUY')
  })

  it('ema tracks toward recent values', () => {
    expect(ema([1, 1, 1, 1, 1], 3)).toBeCloseTo(1, 5)
  })
})

describe('councilVote', () => {
  it('returns BUY when weighted votes exceed threshold', () => {
    const v = councilVote([
      { strategyId: 'a', decision: { signal: 'BUY', confidence: 1, reason: 'up' }, score: 5 },
      { strategyId: 'b', decision: { signal: 'BUY', confidence: 0.8, reason: 'up2' }, score: 0 },
    ], 0.6)
    expect(v.signal).toBe('BUY')
    expect(v.leadStrategyId).toBe('a')
  })

  it('returns HOLD when votes cancel out', () => {
    const v = councilVote([
      { strategyId: 'a', decision: { signal: 'BUY', confidence: 1, reason: 'up' }, score: 0 },
      { strategyId: 'b', decision: { signal: 'SELL', confidence: 1, reason: 'down' }, score: 0 },
    ], 0.6)
    expect(v.signal).toBe('HOLD')
  })

  it('weights proven strategies more heavily', () => {
    const v = councilVote([
      { strategyId: 'proven', decision: { signal: 'BUY', confidence: 1, reason: 'up' }, score: 8 },
      { strategyId: 'weak', decision: { signal: 'SELL', confidence: 1, reason: 'down' }, score: -4 },
    ], 0.6)
    expect(v.signal).toBe('BUY')
    expect(v.leadStrategyId).toBe('proven')
  })
})

describe('scaledQuoteSize', () => {
  it('scales up for proven strategies and down for poor ones', () => {
    expect(scaledQuoteSize(25, 5)).toBeGreaterThan(25)
    expect(scaledQuoteSize(25, -5)).toBeLessThan(25)
  })
})

describe('applyTradeOutcome loss streak', () => {
  it('increments lossStreak on losses and resets on a win', () => {
    let s = emptyScore('x')
    s = applyTradeOutcome(s, -5, 100)
    s = applyTradeOutcome(s, -5, 100)
    expect(s.lossStreak).toBe(2)
    s = applyTradeOutcome(s, 5, 100)
    expect(s.lossStreak).toBe(0)
  })
})
