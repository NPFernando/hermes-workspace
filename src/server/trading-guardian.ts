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
  maxWeeklyLossQuote: number
  /** Halt new entries when open positions are collectively down this much unrealized (quote). */
  maxOpenDrawdownQuote: number
  lossStreakLimit: number
  cooldownMinutes: number
  minQuoteBalance: number
}

export const DEFAULT_GUARDIAN_CONFIG: GuardianConfig = {
  maxOpenPositions: 4,
  perTradeQuoteCap: 50,
  maxDailyLossQuote: 100,
  maxWeeklyLossQuote: 500,
  maxOpenDrawdownQuote: 150,
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
  /** Realized PnL this week (negative = loss). */
  weeklyPnlQuote: number
  /** Mark-to-market PnL of all currently open positions (negative = unrealized loss). */
  openUnrealizedPnlQuote: number
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

  if (ctx.weeklyPnlQuote <= -config.maxWeeklyLossQuote) {
    blocks.push({
      rule: 'weekly_loss_halt',
      detail: `realized ${ctx.weeklyPnlQuote.toFixed(2)} this week breaches -${config.maxWeeklyLossQuote} limit — halted until next week`,
    })
  }

  if (ctx.openUnrealizedPnlQuote <= -config.maxOpenDrawdownQuote) {
    blocks.push({
      rule: 'open_drawdown_halt',
      detail: `open positions down ${ctx.openUnrealizedPnlQuote.toFixed(2)} unrealized, breaches -${config.maxOpenDrawdownQuote} limit — no new entries until the drawdown recovers`,
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

/** UTC ISO week key (YYYY-Www) used to bucket realized PnL for the weekly halt. */
export function weekKey(date: Date | string = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const { year, week } = isoWeekParts(d)
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * Returns the ISO-8601 week-year and week number (1-53) for a date, in UTC.
 * Both are derived from the Thursday of the date's ISO week — the Thursday
 * defines the ISO week-year, so the label year and the week number must come
 * from the *same* Thursday. Deriving the year from the original date instead
 * breaks across the New Year boundary (e.g. 2027-01-01 belongs to 2026-W53),
 * which would let realizedWeekly under-count losses straddling Jan 1.
 * jan4 is built in UTC so week boundaries don't shift by the host TZ offset.
 */
function isoWeekParts(date: Date): { year: number; week: number } {
  const thursday = new Date(date.valueOf())
  const dayNr = (date.getUTCDay() + 6) % 7 // Mon=0 … Sun=6
  thursday.setUTCDate(thursday.getUTCDate() - dayNr + 3)
  const isoYear = thursday.getUTCFullYear()
  const jan4 = new Date(Date.UTC(isoYear, 0, 4))
  const dayDiff = (thursday.valueOf() - jan4.valueOf()) / 86400000
  const week = 1 + Math.ceil(dayDiff / 7)
  return { year: isoYear, week }
}
