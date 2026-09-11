import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STRATEGY_DECAY_CONFIG,
  detectStrategyDecay,
  parseStrategyBaselines,
  resolveStrategyDecayConfig,
} from './strategy-decay'
import type { StrategyBaseline, StrategyDecayConfig } from './strategy-decay'

const baseline: StrategyBaseline = {
  strategyId: 'sma_crossover',
  winRate: 0.6,
  avgPnlQuote: 0.5,
  trades: 200,
  computedAt: '2026-01-01T00:00:00.000Z',
}

const enabledConfig: StrategyDecayConfig = {
  enabled: true,
  winRateDropThreshold: 0.15,
  minTrailingTrades: 5,
}

describe('detectStrategyDecay', () => {
  it('fires when live win rate drops well below the baseline', () => {
    const result = detectStrategyDecay(
      baseline,
      { winRate: 0.3, avgPnlQuote: 0.1, trades: 10 },
      enabledConfig,
    )
    expect(result.decayed).toBe(true)
    expect(result.reason).toMatch(/win rate dropped/i)
    expect(result.winRateDrop).toBeCloseTo(0.3, 5)
  })

  it('fires when expectancy flips from positive to non-positive', () => {
    const result = detectStrategyDecay(
      baseline,
      { winRate: 0.58, avgPnlQuote: -0.02, trades: 10 },
      enabledConfig,
    )
    expect(result.decayed).toBe(true)
    expect(result.expectancyFlipped).toBe(true)
    expect(result.reason).toMatch(/expectancy flipped/i)
  })

  it('does not fire for normal variance within the threshold', () => {
    const result = detectStrategyDecay(
      baseline,
      { winRate: 0.52, avgPnlQuote: 0.4, trades: 10 },
      enabledConfig,
    )
    expect(result.decayed).toBe(false)
    expect(result.reason).toBeNull()
  })

  it('does not fire below the minimum trailing trade count, even if performance looks decayed', () => {
    const result = detectStrategyDecay(
      baseline,
      { winRate: 0.1, avgPnlQuote: -1, trades: 2 },
      enabledConfig,
    )
    expect(result.decayed).toBe(false)
  })

  it('does not fire when detection is disabled', () => {
    const result = detectStrategyDecay(
      baseline,
      { winRate: 0.1, avgPnlQuote: -1, trades: 50 },
      { ...enabledConfig, enabled: false },
    )
    expect(result.decayed).toBe(false)
  })

  it('does not flag expectancy flip when baseline expectancy was never positive', () => {
    const negBaseline: StrategyBaseline = { ...baseline, avgPnlQuote: -0.1 }
    const result = detectStrategyDecay(
      negBaseline,
      { winRate: 0.58, avgPnlQuote: -0.05, trades: 10 },
      enabledConfig,
    )
    expect(result.expectancyFlipped).toBe(false)
  })
})

describe('resolveStrategyDecayConfig', () => {
  it('defaults to disabled with sane thresholds when no override is given', () => {
    expect(resolveStrategyDecayConfig(undefined)).toEqual(
      DEFAULT_STRATEGY_DECAY_CONFIG,
    )
  })

  it('applies valid overrides and rejects out-of-range values', () => {
    const resolved = resolveStrategyDecayConfig({
      enabled: true,
      winRateDropThreshold: 0.25,
      minTrailingTrades: 10,
    })
    expect(resolved).toEqual({
      enabled: true,
      winRateDropThreshold: 0.25,
      minTrailingTrades: 10,
    })

    const rejected = resolveStrategyDecayConfig({
      winRateDropThreshold: 5, // out of (0,1] range
      minTrailingTrades: 0, // below minimum
    })
    expect(rejected.winRateDropThreshold).toBe(
      DEFAULT_STRATEGY_DECAY_CONFIG.winRateDropThreshold,
    )
    expect(rejected.minTrailingTrades).toBe(
      DEFAULT_STRATEGY_DECAY_CONFIG.minTrailingTrades,
    )
  })
})

describe('parseStrategyBaselines', () => {
  it('parses a valid settings blob into a Map keyed by strategyId', () => {
    const map = parseStrategyBaselines({
      sma_crossover: {
        winRate: 0.6,
        avgPnlQuote: 0.5,
        trades: 200,
        computedAt: '2026-01-01T00:00:00.000Z',
      },
    })
    expect(map.get('sma_crossover')).toEqual(baseline)
  })

  it('skips malformed entries instead of throwing', () => {
    const map = parseStrategyBaselines({
      sma_crossover: { winRate: 0.6 }, // missing fields
      macd_momentum: 'not an object',
    })
    expect(map.size).toBe(0)
  })

  it('returns an empty map for undefined/non-object input', () => {
    expect(parseStrategyBaselines(undefined).size).toBe(0)
    expect(parseStrategyBaselines('nope').size).toBe(0)
  })
})
