import { describe, expect, it } from 'vitest'
import {
  applyBucketOutcome,
  atrPctSeries,
  bucketKey,
  bucketVeto,
  buildEntryFeatureVector,
  volRegimeFromHistory,
  type BucketStats,
  type EntryFeatureVector,
} from './trading-pattern-veto'
import type { Candle } from './trading-strategies'

function candle(i: number, close: number, wick = 0.5): Candle {
  return {
    openTime: i * 3_600_000,
    open: close,
    high: close + wick,
    low: close - wick,
    close,
    volume: 100,
  }
}

describe('bucketKey', () => {
  it('is a stable, human-readable composite of the feature vector', () => {
    const f: EntryFeatureVector = { strategyId: 'rsi_reversion', rsiDecile: 2, volRegime: 'high' }
    expect(bucketKey(f)).toBe('rsi_reversion|rsi2|high')
  })
})

describe('applyBucketOutcome', () => {
  it('starts a new bucket at trades:1 and recomputes lossRate each time', () => {
    const f: EntryFeatureVector = { strategyId: 's', rsiDecile: 3, volRegime: 'low' }
    let stats: Record<string, BucketStats> = {}
    stats = applyBucketOutcome(stats, f, -5)
    expect(stats[bucketKey(f)]).toEqual({ key: bucketKey(f), trades: 1, losses: 1, lossRate: 1 })
    stats = applyBucketOutcome(stats, f, 10)
    expect(stats[bucketKey(f)]).toEqual({ key: bucketKey(f), trades: 2, losses: 1, lossRate: 0.5 })
  })

  it('keeps other buckets untouched', () => {
    const a: EntryFeatureVector = { strategyId: 's', rsiDecile: 1, volRegime: 'low' }
    const b: EntryFeatureVector = { strategyId: 's', rsiDecile: 9, volRegime: 'high' }
    let stats: Record<string, BucketStats> = {}
    stats = applyBucketOutcome(stats, a, -1)
    stats = applyBucketOutcome(stats, b, -1)
    expect(stats[bucketKey(a)].trades).toBe(1)
    expect(stats[bucketKey(b)].trades).toBe(1)
  })
})

describe('bucketVeto', () => {
  const f: EntryFeatureVector = { strategyId: 's', rsiDecile: 8, volRegime: 'high' }

  it('vetoes once both the sample floor and loss-rate threshold clear', () => {
    const stats: Record<string, BucketStats> = {
      [bucketKey(f)]: { key: bucketKey(f), trades: 25, losses: 18, lossRate: 0.72 },
    }
    const result = bucketVeto(stats, f, 20, 0.65)
    expect(result.blocked).toBe(true)
    expect(result.detail).toContain('25 trades')
    expect(result.detail).toContain('72%')
  })

  it('does not veto below the sample floor, even at a terrible loss rate', () => {
    const stats: Record<string, BucketStats> = {
      [bucketKey(f)]: { key: bucketKey(f), trades: 15, losses: 15, lossRate: 1 },
    }
    expect(bucketVeto(stats, f, 20, 0.65).blocked).toBe(false)
  })

  it('does not veto a well-sampled bucket at a merely-average loss rate', () => {
    const stats: Record<string, BucketStats> = {
      [bucketKey(f)]: { key: bucketKey(f), trades: 100, losses: 50, lossRate: 0.5 },
    }
    expect(bucketVeto(stats, f, 20, 0.65).blocked).toBe(false)
  })

  it('never vetoes an unseen bucket', () => {
    expect(bucketVeto({}, f, 20, 0.65).blocked).toBe(false)
  })
})

describe('volRegimeFromHistory', () => {
  it('fails open to mid with too little history to judge relative position', () => {
    expect(volRegimeFromHistory([0.01, 0.02], 0.05)).toBe('mid')
  })

  it('classifies against the trailing distribution, not a fixed threshold', () => {
    const history = Array.from({ length: 30 }, (_, i) => 0.01 + i * 0.001) // 0.01..0.039
    expect(volRegimeFromHistory(history, 0.01)).toBe('low')
    expect(volRegimeFromHistory(history, 0.039)).toBe('high')
    expect(volRegimeFromHistory(history, 0.02)).toBe('mid')
  })
})

describe('atrPctSeries', () => {
  it('returns one ATR/price ratio per candle past the warmup period', () => {
    const candles = Array.from({ length: 20 }, (_, i) => candle(i, 100 + i))
    const series = atrPctSeries(candles, 5)
    expect(series.length).toBe(20 - 5)
    for (const v of series) expect(v).toBeGreaterThan(0)
  })

  it('returns an empty series when there are fewer candles than the period', () => {
    expect(atrPctSeries(Array.from({ length: 3 }, (_, i) => candle(i, 100)), 14)).toEqual([])
  })
})

describe('buildEntryFeatureVector', () => {
  it('produces a decile in range and a valid vol regime for a real candle window', () => {
    const candles = Array.from({ length: 60 }, (_, i) => candle(i, 100 + Math.sin(i / 3) * 2))
    const f = buildEntryFeatureVector('rsi_reversion', candles, 14)
    expect(f.strategyId).toBe('rsi_reversion')
    expect(f.rsiDecile).toBeGreaterThanOrEqual(0)
    expect(f.rsiDecile).toBeLessThanOrEqual(9)
    expect(['low', 'mid', 'high']).toContain(f.volRegime)
  })

  it('falls back to a neutral decile 5 / mid regime when there is not enough candle history', () => {
    const candles = [candle(0, 100), candle(1, 101)]
    const f = buildEntryFeatureVector('s', candles, 14)
    expect(f.rsiDecile).toBe(5)
    expect(f.volRegime).toBe('mid')
  })
})
