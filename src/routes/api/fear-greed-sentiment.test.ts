import { describe, expect, it } from 'vitest'
import {
  fearGreedSentimentDecision,
  fetchFearGreedHistory,
  fetchLatestFearGreed,
} from './fear-greed-sentiment'

describe('fearGreedSentimentDecision', () => {
  it('returns HOLD with 0 confidence when there is no data', () => {
    expect(fearGreedSentimentDecision(null)).toEqual({
      signal: 'HOLD',
      confidence: 0,
      reason: 'no fear & greed data',
    })
    expect(fearGreedSentimentDecision(-1)).toMatchObject({
      signal: 'HOLD',
      confidence: 0,
    })
    expect(fearGreedSentimentDecision(101)).toMatchObject({
      signal: 'HOLD',
      confidence: 0,
    })
  })

  it('holds near neutral (value 50, below the confidence floor)', () => {
    const d = fearGreedSentimentDecision(50)
    expect(d.signal).toBe('HOLD')
    expect(d.confidence).toBeCloseTo(0, 6)
  })

  it('leans BUY (contrarian) on extreme fear', () => {
    const d = fearGreedSentimentDecision(10)
    expect(d.signal).toBe('BUY')
    expect(d.confidence).toBeCloseTo(0.8, 6)
  })

  it('leans SELL (contrarian) on extreme greed', () => {
    const d = fearGreedSentimentDecision(90)
    expect(d.signal).toBe('SELL')
    expect(d.confidence).toBeCloseTo(0.8, 6)
  })

  it('caps confidence at 1 at the extremes', () => {
    expect(fearGreedSentimentDecision(0).confidence).toBe(1)
    expect(fearGreedSentimentDecision(100).confidence).toBe(1)
  })
})

describe('fetchFearGreedHistory', () => {
  it('builds the correct URL and parses string fields to numbers', async () => {
    let capturedUrl = ''
    const fakeFetchJson = async <T>(url: string): Promise<T> => {
      capturedUrl = url
      return {
        data: [
          {
            value: '31',
            value_classification: 'Fear',
            timestamp: '1784764800',
          },
          {
            value: '33',
            value_classification: 'Fear',
            timestamp: '1784678400',
          },
        ],
      } as unknown as T
    }
    const points = await fetchFearGreedHistory(2, fakeFetchJson)
    expect(capturedUrl).toBe(
      'https://api.alternative.me/fng/?limit=2&format=json',
    )
    expect(points).toEqual([
      { value: 31, classification: 'Fear', timestamp: 1784764800 },
      { value: 33, classification: 'Fear', timestamp: 1784678400 },
    ])
  })
})

describe('fetchLatestFearGreed', () => {
  it('returns the first point from history', async () => {
    const fakeFetchJson = async <T>(): Promise<T> =>
      ({
        data: [
          {
            value: '42',
            value_classification: 'Fear',
            timestamp: '1784764800',
          },
        ],
      }) as unknown as T
    const point = await fetchLatestFearGreed(fakeFetchJson)
    expect(point).toEqual({
      value: 42,
      classification: 'Fear',
      timestamp: 1784764800,
    })
  })

  it('returns null when there is no data', async () => {
    const fakeFetchJson = async <T>(): Promise<T> =>
      ({ data: [] }) as unknown as T
    expect(await fetchLatestFearGreed(fakeFetchJson)).toBeNull()
  })
})
