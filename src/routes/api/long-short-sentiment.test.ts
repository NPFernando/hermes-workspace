import { describe, expect, it } from 'vitest'
import {
  fetchTopTraderLongShortRatio,
  longShortSentimentDecision,
} from './long-short-sentiment'

describe('longShortSentimentDecision', () => {
  it('returns HOLD with 0 confidence when there is no data', () => {
    expect(longShortSentimentDecision(null)).toEqual({
      signal: 'HOLD',
      confidence: 0,
      reason: 'no long/short data',
    })
    expect(longShortSentimentDecision(0)).toMatchObject({
      signal: 'HOLD',
      confidence: 0,
    })
    expect(longShortSentimentDecision(-1)).toMatchObject({
      signal: 'HOLD',
      confidence: 0,
    })
  })

  it('holds near parity (ratio 1.0, below the confidence floor)', () => {
    const d = longShortSentimentDecision(1.0)
    expect(d.signal).toBe('HOLD')
    expect(d.confidence).toBeCloseTo(0, 6)
  })

  it('leans BUY when more accounts are long, confidence scales with the skew', () => {
    const d = longShortSentimentDecision(1.5)
    expect(d.signal).toBe('BUY')
    expect(d.confidence).toBeCloseTo(0.5, 6)
  })

  it('leans SELL when more accounts are short (ratio below 1), using the inverse skew', () => {
    // 1/0.5 - 1 = 1.0, capped at 1
    const d = longShortSentimentDecision(0.5)
    expect(d.signal).toBe('SELL')
    expect(d.confidence).toBeCloseTo(1, 6)
  })

  it('caps confidence at 1 for an extreme long skew', () => {
    const d = longShortSentimentDecision(2.5)
    expect(d.signal).toBe('BUY')
    expect(d.confidence).toBe(1)
  })
})

describe('fetchTopTraderLongShortRatio', () => {
  it('builds the correct URL and parses string fields to numbers', async () => {
    let capturedUrl = ''
    const fakeFetchJson = async <T>(url: string): Promise<T> => {
      capturedUrl = url
      return [
        {
          symbol: 'BTCUSDT',
          longShortRatio: '1.85',
          longAccount: '0.65',
          shortAccount: '0.35',
          timestamp: '1720000000000',
        },
      ] as unknown as T
    }
    const points = await fetchTopTraderLongShortRatio(
      'BTCUSDT',
      '1h',
      1,
      fakeFetchJson,
    )
    expect(capturedUrl).toBe(
      'https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1',
    )
    expect(points).toEqual([
      {
        symbol: 'BTCUSDT',
        longShortRatio: 1.85,
        longAccount: 0.65,
        shortAccount: 0.35,
        timestamp: 1720000000000,
      },
    ])
  })

  it('propagates a fetch failure rather than swallowing it (callers are responsible for try/catch)', async () => {
    const failingFetchJson = async <T>(): Promise<T> => {
      throw new Error('network error')
    }
    await expect(
      fetchTopTraderLongShortRatio('BTCUSDT', '1h', 1, failingFetchJson),
    ).rejects.toThrow('network error')
  })
})
