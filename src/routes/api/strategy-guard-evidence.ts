/**
 * Windowed strategy evidence for guard review.
 *
 * `StrategyScore` (trading-strategies.ts) accumulates all-time stats for a
 * strategy and never expires old trades, so a strategy that struggled early
 * on can look permanently weak (or a strategy that only recently decayed can
 * look permanently fine) long after conditions changed. This module adds a
 * bounded recent-evaluation-window view alongside the all-time score, plus
 * an explicit recommendation state, so the trading UI can show *why* a
 * strategy is (or isn't) flagged instead of just a raw number.
 *
 * Pure / no I/O — mirrors strategy-decay.ts's precedent for testable
 * analytical helpers that demo-trading-engine.ts composes with its own
 * persisted state.
 */

export interface StrategyEvidenceTrade {
  strategyId: string
  pnlQuote: number
  closedAt: string
  reason: string
}

export interface StrategyEvidenceWindow {
  strategyId: string
  windowDays: number
  windowStart: string
  windowEnd: string
  closedTrades: number
  wins: number
  losses: number
  winRate: number
  lossRate: number
  realizedPnlQuote: number
  avgWinQuote: number
  avgLossQuote: number
  /** Non-negative outcomes that weren't a forced close, within the window. */
  recoveredTrades: number
  /** Forced-close outcomes (guardian safety valves), within the window. */
  forcedCloseTrades: number
  /** False when `closedTrades` is below the configured minimum sample — the
   * caller must not evaluate the guard trigger against this window. */
  sufficientSample: boolean
}

export type StrategyGuardRecommendation =
  | 'insufficient_evidence'
  | 'monitor'
  | 'reduce_size_candidate'
  | 'disable_candidate'
  | 'recovered'

export interface StrategyGuardReview {
  strategyId: string
  allTime: { trades: number; winRate: number; totalPnlQuote: number }
  window: StrategyEvidenceWindow
  recommendation: StrategyGuardRecommendation
  reason: string
  /** Whether the strategy currently has an automatic guard or sandbox
   * experiment override in effect (used only to distinguish "recovered"
   * from "monitor" below — a manual override never changes this). */
  hasActiveGuardOrExperiment: boolean
}

/** Computes bounded recent-window metrics for one strategy from its full
 * closed-trade log. `now` is injectable so callers/tests can pin the clock. */
export function computeStrategyEvidenceWindow(
  strategyId: string,
  trades: Array<StrategyEvidenceTrade>,
  windowDays: number,
  minSample: number,
  now: string = new Date().toISOString(),
): StrategyEvidenceWindow {
  const nowMs = Date.parse(now)
  const windowStartMs = nowMs - Math.max(1, windowDays) * 24 * 60 * 60 * 1000
  const windowed = trades.filter((trade) => {
    if (trade.strategyId !== strategyId) return false
    const closedAtMs = Date.parse(trade.closedAt)
    return (
      Number.isFinite(closedAtMs) &&
      closedAtMs >= windowStartMs &&
      closedAtMs <= nowMs
    )
  })
  const wins = windowed.filter((trade) => trade.pnlQuote > 0)
  const losses = windowed.filter((trade) => trade.pnlQuote < 0)
  const closedTrades = windowed.length
  const realizedPnlQuote = windowed.reduce(
    (sum, trade) => sum + trade.pnlQuote,
    0,
  )
  const recoveredTrades = windowed.filter(
    (trade) => trade.pnlQuote >= 0 && !trade.reason.includes('force-closed'),
  ).length
  const forcedCloseTrades = windowed.filter((trade) =>
    trade.reason.includes('force-closed'),
  ).length
  return {
    strategyId,
    windowDays,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: now,
    closedTrades,
    wins: wins.length,
    losses: losses.length,
    winRate: closedTrades > 0 ? wins.length / closedTrades : 0,
    lossRate: closedTrades > 0 ? losses.length / closedTrades : 0,
    realizedPnlQuote,
    avgWinQuote:
      wins.length > 0
        ? wins.reduce((sum, trade) => sum + trade.pnlQuote, 0) / wins.length
        : 0,
    avgLossQuote:
      losses.length > 0
        ? losses.reduce((sum, trade) => sum + trade.pnlQuote, 0) /
          losses.length
        : 0,
    recoveredTrades,
    forcedCloseTrades,
    sufficientSample: closedTrades >= Math.max(1, minSample),
  }
}

/**
 * Derives an explicit recommendation from a computed window. The trigger
 * comparison intentionally mirrors `applyAutomaticStrategyGuard`'s existing
 * (win-rate-based, despite the "loss rate threshold" config name) condition
 * in demo-trading-engine.ts, so this reporting layer never disagrees with
 * what the engine itself would do — it only adds the missing "why" and the
 * insufficient-sample gate.
 */
export function deriveGuardRecommendation(input: {
  window: StrategyEvidenceWindow
  guardWinRateThreshold: number
  guardMaxPnlQuote: number
  guardAction: 'disabled' | 'reduce_size'
  hasActiveGuardOrExperiment: boolean
}): { recommendation: StrategyGuardRecommendation; reason: string } {
  const {
    window,
    guardWinRateThreshold,
    guardMaxPnlQuote,
    guardAction,
    hasActiveGuardOrExperiment,
  } = input
  if (!window.sufficientSample) {
    return {
      recommendation: 'insufficient_evidence',
      reason: `Only ${window.closedTrades} closed trade(s) in the last ${window.windowDays} days — too thin to act on.`,
    }
  }
  const triggered =
    window.winRate <= guardWinRateThreshold &&
    window.realizedPnlQuote <= guardMaxPnlQuote
  if (triggered) {
    return {
      recommendation:
        guardAction === 'disabled' ? 'disable_candidate' : 'reduce_size_candidate',
      reason: `${window.closedTrades} trades in ${window.windowDays}d, ${(window.winRate * 100).toFixed(1)}% win rate, ${window.realizedPnlQuote.toFixed(2)} USDT realized.`,
    }
  }
  if (hasActiveGuardOrExperiment) {
    return {
      recommendation: 'recovered',
      reason: `Recent window no longer meets the guard trigger (${(window.winRate * 100).toFixed(1)}% win rate, ${window.realizedPnlQuote.toFixed(2)} USDT) — safe to review or re-enable.`,
    }
  }
  return {
    recommendation: 'monitor',
    reason: `${window.closedTrades} trades in ${window.windowDays}d within normal thresholds.`,
  }
}
