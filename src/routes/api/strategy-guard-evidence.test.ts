import { describe, expect, it } from 'vitest'
import {
  computeStrategyEvidenceWindow,
  deriveGuardRecommendation,
} from './strategy-guard-evidence'
import type { StrategyEvidenceTrade } from './strategy-guard-evidence'

const NOW = '2026-08-15T00:00:00.000Z'

function tradesFixture(): Array<StrategyEvidenceTrade> {
  return [
    // In-window losing trades (last 14 days).
    {
      strategyId: 'sma_crossover',
      pnlQuote: -3,
      closedAt: '2026-08-10T00:00:00.000Z',
      reason: 'stop-loss',
    },
    {
      strategyId: 'sma_crossover',
      pnlQuote: -2,
      closedAt: '2026-08-12T00:00:00.000Z',
      reason: 'stop-loss',
    },
    {
      strategyId: 'sma_crossover',
      pnlQuote: 1,
      closedAt: '2026-08-13T00:00:00.000Z',
      reason: 'take-profit',
    },
    // Outside the 14-day window — must not count.
    {
      strategyId: 'sma_crossover',
      pnlQuote: 50,
      closedAt: '2026-06-01T00:00:00.000Z',
      reason: 'take-profit',
    },
    // A different strategy entirely — must not count.
    {
      strategyId: 'rsi_reversion',
      pnlQuote: 10,
      closedAt: '2026-08-14T00:00:00.000Z',
      reason: 'take-profit',
    },
    {
      strategyId: 'sma_crossover',
      pnlQuote: -4,
      closedAt: '2026-08-14T00:00:00.000Z',
      reason: 'force-closed-unsellable',
    },
  ]
}

describe('computeStrategyEvidenceWindow', () => {
  it('separates windowed trades from all-time/other-strategy trades', () => {
    const window = computeStrategyEvidenceWindow(
      'sma_crossover',
      tradesFixture(),
      14,
      3,
      NOW,
    )
    expect(window.closedTrades).toBe(4)
    expect(window.wins).toBe(1)
    expect(window.losses).toBe(3)
    expect(window.winRate).toBeCloseTo(0.25)
    expect(window.lossRate).toBeCloseTo(0.75)
    expect(window.realizedPnlQuote).toBeCloseTo(-8)
    expect(window.avgWinQuote).toBeCloseTo(1)
    expect(window.avgLossQuote).toBeCloseTo(-3)
    expect(window.recoveredTrades).toBe(1)
    expect(window.forcedCloseTrades).toBe(1)
  })

  it('flags insufficient sample below the configured minimum', () => {
    const window = computeStrategyEvidenceWindow(
      'sma_crossover',
      tradesFixture(),
      14,
      10,
      NOW,
    )
    expect(window.sufficientSample).toBe(false)
  })

  it('flags sufficient sample at or above the configured minimum', () => {
    const window = computeStrategyEvidenceWindow(
      'sma_crossover',
      tradesFixture(),
      14,
      4,
      NOW,
    )
    expect(window.sufficientSample).toBe(true)
  })

  it('returns a zeroed window when there are no matching trades', () => {
    const window = computeStrategyEvidenceWindow('unknown_strategy', [], 14, 5, NOW)
    expect(window.closedTrades).toBe(0)
    expect(window.winRate).toBe(0)
    expect(window.lossRate).toBe(0)
    expect(window.realizedPnlQuote).toBe(0)
    expect(window.sufficientSample).toBe(false)
  })
})

describe('deriveGuardRecommendation', () => {
  function windowWith(overrides: Partial<ReturnType<typeof baseWindow>>) {
    return { ...baseWindow(), ...overrides }
  }
  function baseWindow() {
    return computeStrategyEvidenceWindow('sma_crossover', tradesFixture(), 14, 4, NOW)
  }

  it('recommends insufficient_evidence when the sample is too thin', () => {
    const window = computeStrategyEvidenceWindow(
      'sma_crossover',
      tradesFixture(),
      14,
      10,
      NOW,
    )
    const result = deriveGuardRecommendation({
      window,
      guardWinRateThreshold: 0.4,
      guardMaxPnlQuote: 0,
      guardAction: 'reduce_size',
      hasActiveGuardOrExperiment: false,
    })
    expect(result.recommendation).toBe('insufficient_evidence')
  })

  it('recommends reduce_size_candidate when triggered and action is reduce_size', () => {
    const result = deriveGuardRecommendation({
      window: baseWindow(),
      guardWinRateThreshold: 0.4,
      guardMaxPnlQuote: 0,
      guardAction: 'reduce_size',
      hasActiveGuardOrExperiment: false,
    })
    expect(result.recommendation).toBe('reduce_size_candidate')
  })

  it('recommends disable_candidate when triggered and action is disabled', () => {
    const result = deriveGuardRecommendation({
      window: baseWindow(),
      guardWinRateThreshold: 0.4,
      guardMaxPnlQuote: 0,
      guardAction: 'disabled',
      hasActiveGuardOrExperiment: false,
    })
    expect(result.recommendation).toBe('disable_candidate')
  })

  it('recommends recovered when no longer triggered but a guard/experiment is active', () => {
    const window = windowWith({ winRate: 0.6, lossRate: 0.4, realizedPnlQuote: 20 })
    const result = deriveGuardRecommendation({
      window,
      guardWinRateThreshold: 0.4,
      guardMaxPnlQuote: 0,
      guardAction: 'reduce_size',
      hasActiveGuardOrExperiment: true,
    })
    expect(result.recommendation).toBe('recovered')
  })

  it('recommends monitor when within thresholds and nothing is active', () => {
    const window = windowWith({ winRate: 0.6, lossRate: 0.4, realizedPnlQuote: 20 })
    const result = deriveGuardRecommendation({
      window,
      guardWinRateThreshold: 0.4,
      guardMaxPnlQuote: 0,
      guardAction: 'reduce_size',
      hasActiveGuardOrExperiment: false,
    })
    expect(result.recommendation).toBe('monitor')
  })
})
