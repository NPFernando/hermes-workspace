import { describe, expect, it } from 'vitest'
import {
  buildCompositeSentiment,
  buildPaperDecision,
  classifyNewsItem,
} from './finance-intelligence'
import type { NewsItem, SentimentScore } from './finance-store'

const now = new Date('2026-08-20T12:00:00.000Z')
function news(id: string, summary: string, ageHours = 1): NewsItem {
  const timestamp = new Date(
    now.getTime() - ageHours * 60 * 60 * 1000,
  ).toISOString()
  return {
    id,
    sourceName: 'Fixture',
    sourceUrl: 'https://example.test',
    publishDate: timestamp,
    relatedSymbol: 'BTCUSDT',
    summary,
    sentiment: 'unknown',
    riskImpact: 'medium_risk',
    confidenceScore: 0,
    changedDecision: false,
    source: 'test',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
function fearGreed(value: number): SentimentScore {
  const timestamp = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
  return {
    id: 'fg-1',
    symbol: 'BTCUSDT',
    kind: 'fear_greed',
    score: value,
    label: 'neutral',
    confidenceScore: 0.5,
    freshness: 1,
    inputRefs: ['alternative-me:1'],
    formulaVersion: 'raw-v1',
    observedAt: timestamp,
    expiresAt: now.toISOString(),
    source: 'alternative.me',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

describe('finance intelligence', () => {
  it('classifies deterministic positive, negative, and mixed headlines', () => {
    expect(
      classifyNewsItem(
        news('positive', 'Bitcoin rally on institutional adoption'),
      ).label,
    ).toBe('positive')
    expect(
      classifyNewsItem(news('negative', 'Exchange hack triggers liquidation'))
        .label,
    ).toBe('negative')
    expect(
      classifyNewsItem(news('mixed', 'Adoption grows despite exchange hack'))
        .label,
    ).toBe('mixed')
  })

  it('uses stable source references and a stored Fear & Greed observation', () => {
    const input = {
      symbol: 'btcusdt',
      items: [news('b', 'Bitcoin rally'), news('a', 'Bitcoin adoption gain')],
      sentimentScores: [fearGreed(20)],
      now,
    }
    const first = buildCompositeSentiment(input)
    const second = buildCompositeSentiment({
      ...input,
      items: input.items.slice().reverse(),
    })
    expect(second).toEqual(first)
    expect(first).toMatchObject({
      symbol: 'BTCUSDT',
      label: 'positive',
      sourceIds: ['a', 'b', 'fg-1'],
      formulaVersion: 'research-v1',
    })
  })

  it('abstains conservatively for stale or conflicting evidence', () => {
    const stale = buildCompositeSentiment({
      symbol: 'BTCUSDT',
      items: [news('old', 'Bitcoin rally', 49)],
      now,
    })
    const mixed = buildCompositeSentiment({
      symbol: 'BTCUSDT',
      items: [news('up', 'Bitcoin rally'), news('down', 'Exchange hack')],
      now,
    })
    expect(buildPaperDecision(stale)).toMatchObject({
      decision: 'HOLD',
      abstain: true,
    })
    expect(buildPaperDecision(mixed)).toMatchObject({
      decision: 'HOLD',
      abstain: true,
    })
    expect(mixed.blockers).toContain('conflicting headline evidence')
  })
})
