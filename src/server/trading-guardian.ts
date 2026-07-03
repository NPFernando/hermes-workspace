/**
 * Guardian risk layer — ported from the VT-Capital "guardian OMS" concept
 * into the finance demo engine.
 *
 * Every order proposal must pass these checks before execution:
 *   - position cap        (never more than N concurrent positions)
 *   - per-trade quote cap (one trade can never exceed X quote)
 *   - daily loss halt     (realized losses today past the limit → stop for the day)
 *   - loss-streak cooldown(strategy that keeps losing sits out for a while)
 *   - balance floor       (keep a minimum quote reserve untouched)
 *
 * Pure functions — the engine supplies context, the guardian only judges.
 * Blocks are surfaced like VT-Capital's `recentBlocks` so the UI can show
 * why the system chose not to trade.
 */

export interface GuardianConfig {
  maxOpenPositions: number
  perTradeQuoteCap: number
  maxDailyLossQuote: number
  lossStreakLimit: number
  cooldownMinutes: number
  minQuoteBalance: number
}

export const DEFAULT_GUARDIAN_CONFIG: GuardianConfig = {
  maxOpenPositions: 4,
  perTradeQuoteCap: 50,
  maxDailyLossQuote: 100,
  lossStreakLimit: 3,
  cooldownMinutes: 240,
  minQuoteBalance: 500,
}

export interface OrderProposal {
  symbol: string
  strategyId: string
  quoteAmount: number
}

export interface GuardianContext {
  openPositions: number
  /** Free quote (USDT) balance on the demo account. */
  quoteBalance: number
  /** Realized PnL today (negative = loss). */
  dailyPnlQuote: number
  /** Consecutive losses for the proposing strategy. */
  strategyLossStreak: number
  /** ISO timestamp until which the proposing strategy is cooling down. */
  strategyCooldownUntil?: string | null
  now?: Date
}

export interface GuardianBlock {
  rule: string
  detail: string
}

export interface GuardianVerdict {
  allowed: boolean
  /** Quote amount possibly reduced to respect the per-trade cap. */
  approvedQuote: number
  blocks: Array<GuardianBlock>
}

export function checkOrderProposal(
  proposal: OrderProposal,
  ctx: GuardianContext,
  config: GuardianConfig = DEFAULT_GUARDIAN_CONFIG,
): GuardianVerdict {
  const blocks: Array<GuardianBlock> = []
  const now = ctx.now ?? new Date()

  if (ctx.openPositions >= config.maxOpenPositions) {
    blocks.push({
      rule: 'position_cap',
      detail: `${ctx.openPositions} open positions >= cap ${config.maxOpenPositions}`,
    })
  }

  if (ctx.dailyPnlQuote <= -config.maxDailyLossQuote) {
    blocks.push({
      rule: 'daily_loss_halt',
      detail: `realized ${ctx.dailyPnlQuote.toFixed(2)} today breaches -${config.maxDailyLossQuote} limit — halted until tomorrow`,
    })
  }

  if (ctx.strategyCooldownUntil && new Date(ctx.strategyCooldownUntil) > now) {
    blocks.push({
      rule: 'loss_streak_cooldown',
      detail: `${proposal.strategyId} cooling down until ${ctx.strategyCooldownUntil} after ${ctx.strategyLossStreak} consecutive losses`,
    })
  }

  const approvedQuote = Math.min(proposal.quoteAmount, config.perTradeQuoteCap)
  if (ctx.quoteBalance - approvedQuote < config.minQuoteBalance) {
    blocks.push({
      rule: 'balance_floor',
      detail: `spending ${approvedQuote.toFixed(2)} would drop balance ${ctx.quoteBalance.toFixed(2)} below floor ${config.minQuoteBalance}`,
    })
  }

  return { allowed: blocks.length === 0, approvedQuote, blocks }
}

/** Cooldown end time for a strategy that just hit the loss-streak limit. */
export function cooldownUntil(config: GuardianConfig, from: Date = new Date()): string {
  return new Date(from.getTime() + config.cooldownMinutes * 60_000).toISOString()
}

/** UTC day key (YYYY-MM-DD) used to bucket realized PnL for the daily halt. */
export function dayKey(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toISOString().slice(0, 10)
}
