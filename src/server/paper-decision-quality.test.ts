import { describe, expect, it } from 'vitest'
import {
  PAPER_DECISION_OUTCOME_HORIZON_MS,
  evaluatePaperDecisionQuality,
} from './paper-decision-quality'
import type { PaperDecisionJournalEntry } from './paper-decision-journal'

const decisionAt = '2026-08-20T00:00:00.000Z'
const evaluatedAt = '2026-08-20T05:00:00.000Z'

function decision(
  overrides: Partial<PaperDecisionJournalEntry> = {},
): PaperDecisionJournalEntry {
  return {
    id: 'paper-decision:one',
    kind: 'research_snapshot',
    symbol: 'BTCUSDT',
    compositeIntelligenceId: 'composite:one',
    compositeScore: 60,
    provenance: {
      formulaVersion: 'research-v1',
      sourceIds: [],
      observedAt: decisionAt,
    },
    recordedAt: decisionAt,
    idempotencyKey: 'one',
    side_effects: false,
    ...overrides,
  }
}

function candle(input: {
  openedAt: string
  closedAt: string
  open?: number
  high?: number
  low?: number
  close?: number
  symbol?: string
}): Record<string, unknown> {
  const open = input.open ?? 100
  return {
    symbol: input.symbol ?? 'BTCUSDT',
    openedAt: input.openedAt,
    closedAt: input.closedAt,
    open,
    high: input.high ?? open,
    low: input.low ?? open,
    close: input.close ?? open,
  }
}

describe('evaluatePaperDecisionQuality', () => {
  it('excludes candles that are not strictly after the decision time', () => {
    const report = evaluatePaperDecisionQuality({
      decisions: [decision()],
      historicalCandles: [
        candle({
          openedAt: decisionAt,
          closedAt: '2026-08-20T01:00:00.000Z',
          close: 50,
        }),
        candle({
          openedAt: '2026-08-20T01:00:00.000Z',
          closedAt: '2026-08-20T04:00:00.000Z',
          open: 100,
          high: 110,
          low: 90,
          close: 110,
        }),
      ],
      evaluatedAt,
    })

    expect(report).toMatchObject({
      sampleCount: 1,
      coveredSampleCount: 1,
      directionalHitRate: 1,
      averageAdverseMovePct: 10,
      worstAdverseMovePct: 10,
    })
  })

  it('includes the horizon boundary but excludes a later candle', () => {
    const report = evaluatePaperDecisionQuality({
      decisions: [decision()],
      historicalCandles: [
        candle({
          openedAt: '2026-08-20T01:00:00.000Z',
          closedAt: '2026-08-20T04:00:00.000Z',
          open: 100,
          high: 110,
          low: 95,
          close: 110,
        }),
        candle({
          openedAt: '2026-08-20T04:00:00.001Z',
          closedAt: '2026-08-20T04:30:00.000Z',
          open: 110,
          high: 111,
          low: 70,
          close: 80,
        }),
      ],
      evaluatedAt,
    })

    expect(report.coveredSampleCount).toBe(1)
    expect(report.directionalHitRate).toBe(1)
    expect(report.averageAdverseMovePct).toBe(5)
    expect(report.horizon.durationMs).toBe(PAPER_DECISION_OUTCOME_HORIZON_MS)
  })

  it('abstains for missing, stale, and not-yet-mature outcome data', () => {
    const stale = decision({
      id: 'paper-decision:stale',
      idempotencyKey: 'stale',
    })
    const missing = decision({
      id: 'paper-decision:missing',
      idempotencyKey: 'missing',
      symbol: 'ETHUSDT',
    })
    const immature = decision({
      id: 'paper-decision:immature',
      idempotencyKey: 'immature',
      recordedAt: '2026-08-20T03:00:00.000Z',
    })
    const report = evaluatePaperDecisionQuality({
      decisions: [stale, missing, immature],
      historicalCandles: [
        candle({
          openedAt: '2026-08-20T00:01:00.000Z',
          closedAt: '2026-08-20T01:00:00.000Z',
          high: 101,
          close: 101,
        }),
      ],
      evaluatedAt,
    })

    expect(report).toMatchObject({
      sampleCount: 3,
      coveredSampleCount: 0,
      abstainedSampleCount: 3,
      coverage: 0,
      abstentionRate: 1,
      directionalHitRate: null,
      abstentions: {
        stale_outcome_candles: 1,
        missing_outcome_candles: 1,
        horizon_not_elapsed: 1,
      },
    })
  })

  it('is repeatable and leaves caller-owned decisions and candles untouched', () => {
    const decisions = [decision({ compositeScore: -80 })]
    const candles = [
      candle({
        openedAt: '2026-08-20T01:00:00.000Z',
        closedAt: '2026-08-20T04:00:00.000Z',
        open: 100,
        high: 110,
        low: 80,
        close: 90,
      }),
    ]
    const before = JSON.stringify({ decisions, candles })
    const input = { decisions, historicalCandles: candles, evaluatedAt }

    const first = evaluatePaperDecisionQuality(input)
    const second = evaluatePaperDecisionQuality(input)

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      directionalHitRate: 1,
      averageAdverseMovePct: 10,
      worstAdverseMovePct: 10,
      sideEffects: false,
    })
    expect(JSON.stringify({ decisions, candles })).toBe(before)
  })
})
