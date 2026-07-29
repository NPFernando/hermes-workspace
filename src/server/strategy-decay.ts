/**
 * Strategy-decay detection: compares a strategy's LIVE trailing performance
 * against its own validated backtest baseline (not a generic fixed floor —
 * see strategyRecommendation()/decisionQualityReport() in
 * demo-trading-engine.ts for the existing absolute-threshold checks this
 * complements). Detection is audit-log-only; it never disables a strategy
 * or changes sizing itself, matching this codebase's precedent of flagging
 * risk gaps for explicit review rather than auto-acting on them.
 *
 * Baselines are populated deliberately, not automatically on every backtest
 * run (see saveStrategyBaselines() / scripts/backtest-trading.ts's
 * --save-baselines flag) — a backtest result should be reviewed before it's
 * trusted as the live comparison point.
 */
import { appendAuditLog, readFinanceStore, writeFinanceStore } from './finance-store'

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

/**
 * Persists validated backtest summaries as live-comparison baselines.
 * Shared by the save_strategy_baseline API action and
 * scripts/backtest-trading.ts's --save-baselines flag, so both write
 * through the exact same path into settings.strategyBaselines
 * (finance-store.ts) rather than each hand-rolling the merge/write.
 */
export function saveStrategyBaselines(
  reports: Array<{ strategyId: string; winRate: number; avgPnlQuote: number; trades: number }>,
  source: string,
): void {
  if (reports.length === 0) return
  const db = readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  const baselines = (
    settings.strategyBaselines && typeof settings.strategyBaselines === 'object'
      ? { ...(settings.strategyBaselines as Record<string, unknown>) }
      : {}
  ) as Record<string, unknown>
  const computedAt = new Date().toISOString()
  const saved: Array<StrategyBaseline> = []
  for (const r of reports) {
    if (r.trades === 0) continue // no-trade strategies aren't a meaningful baseline
    const baseline: StrategyBaseline = {
      strategyId: r.strategyId,
      winRate: r.winRate,
      avgPnlQuote: r.avgPnlQuote,
      trades: r.trades,
      computedAt,
    }
    baselines[r.strategyId] = baseline
    saved.push(baseline)
  }
  if (saved.length === 0) return
  settings.strategyBaselines = baselines
  writeFinanceStore(db)
  appendAuditLog('strategy_baselines_saved', {
    source,
    strategyIds: saved.map((b) => b.strategyId),
    computedAt,
  })
}
