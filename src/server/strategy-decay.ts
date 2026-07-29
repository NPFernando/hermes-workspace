/**
 * Strategy-decay detection: compares a strategy's LIVE trailing performance
 * against its own validated backtest baseline (not a generic fixed floor —
 * see strategyRecommendation()/decisionQualityReport() in
 * demo-trading-engine.ts for the existing absolute-threshold checks this
 * complements). Detection is audit-log-only; it never disables a strategy
 * or changes sizing itself, matching this codebase's precedent of flagging
 * risk gaps for explicit review rather than auto-acting on them.
 */

export type StrategyBaseline = {
  strategyId: string
  winRate: number
  avgPnlQuote: number
  trades: number
  computedAt: string
}

export type StrategyDecayConfig = {
  enabled: boolean
  /** Percentage points (0-1 scale) live win rate may drop below baseline before flagging. */
  winRateDropThreshold: number
  /** Minimum live trailing trades required before a comparison is meaningful. */
  minTrailingTrades: number
}

export const DEFAULT_STRATEGY_DECAY_CONFIG: StrategyDecayConfig = {
  enabled: false,
  winRateDropThreshold: 0.15,
  minTrailingTrades: 5,
}

export function resolveStrategyDecayConfig(
  settingsOverride: unknown,
): StrategyDecayConfig {
  const override =
    settingsOverride && typeof settingsOverride === 'object'
      ? (settingsOverride as Record<string, unknown>)
      : {}
  return {
    enabled:
      typeof override.enabled === 'boolean'
        ? override.enabled
        : DEFAULT_STRATEGY_DECAY_CONFIG.enabled,
    winRateDropThreshold:
      typeof override.winRateDropThreshold === 'number' &&
      Number.isFinite(override.winRateDropThreshold) &&
      override.winRateDropThreshold > 0 &&
      override.winRateDropThreshold <= 1
        ? override.winRateDropThreshold
        : DEFAULT_STRATEGY_DECAY_CONFIG.winRateDropThreshold,
    minTrailingTrades:
      typeof override.minTrailingTrades === 'number' &&
      Number.isFinite(override.minTrailingTrades) &&
      override.minTrailingTrades >= 1
        ? Math.floor(override.minTrailingTrades)
        : DEFAULT_STRATEGY_DECAY_CONFIG.minTrailingTrades,
  }
}

export function parseStrategyBaselines(
  settingsOverride: unknown,
): Map<string, StrategyBaseline> {
  const map = new Map<string, StrategyBaseline>()
  if (!settingsOverride || typeof settingsOverride !== 'object') return map
  for (const [strategyId, raw] of Object.entries(
    settingsOverride as Record<string, unknown>,
  )) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (
      typeof r.winRate !== 'number' ||
      typeof r.avgPnlQuote !== 'number' ||
      typeof r.trades !== 'number' ||
      typeof r.computedAt !== 'string'
    )
      continue
    map.set(strategyId, {
      strategyId,
      winRate: r.winRate,
      avgPnlQuote: r.avgPnlQuote,
      trades: r.trades,
      computedAt: r.computedAt,
    })
  }
  return map
}

export type StrategyDecayResult = {
  decayed: boolean
  reason: string | null
  winRateDrop: number
  expectancyFlipped: boolean
}

/**
 * Pure comparison — no I/O, no audit logging (callers append the audit
 * event themselves so this stays trivially testable).
 */
export function detectStrategyDecay(
  baseline: StrategyBaseline,
  live: { winRate: number; avgPnlQuote: number; trades: number },
  config: StrategyDecayConfig,
): StrategyDecayResult {
  if (!config.enabled || live.trades < config.minTrailingTrades) {
    return {
      decayed: false,
      reason: null,
      winRateDrop: 0,
      expectancyFlipped: false,
    }
  }
  const winRateDrop = baseline.winRate - live.winRate
  const expectancyFlipped = baseline.avgPnlQuote > 0 && live.avgPnlQuote <= 0
  const decayed = winRateDrop >= config.winRateDropThreshold || expectancyFlipped
  if (!decayed) {
    return { decayed: false, reason: null, winRateDrop, expectancyFlipped }
  }
  const reason = expectancyFlipped
    ? `Expectancy flipped non-positive (baseline avg ${baseline.avgPnlQuote.toFixed(4)} -> live ${live.avgPnlQuote.toFixed(4)})`
    : `Win rate dropped ${(winRateDrop * 100).toFixed(1)}pp below baseline (${(baseline.winRate * 100).toFixed(1)}% -> ${(live.winRate * 100).toFixed(1)}%)`
  return { decayed: true, reason, winRateDrop, expectancyFlipped }
}
