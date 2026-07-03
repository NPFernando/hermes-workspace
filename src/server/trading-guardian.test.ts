import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GUARDIAN_CONFIG,
  checkOrderProposal,
  cooldownUntil,
  dayKey,
  type GuardianContext,
} from './trading-guardian'

const baseCtx: GuardianContext = {
  openPositions: 0,
  quoteBalance: 5000,
  dailyPnlQuote: 0,
  strategyLossStreak: 0,
  strategyCooldownUntil: null,
}
const proposal = { symbol: 'BTCUSDT', strategyId: 'rsi_reversion', quoteAmount: 25 }

describe('checkOrderProposal', () => {
  it('allows a clean proposal', () => {
    const v = checkOrderProposal(proposal, baseCtx)
    expect(v.allowed).toBe(true)
    expect(v.approvedQuote).toBe(25)
    expect(v.blocks).toHaveLength(0)
  })

  it('caps the quote at the per-trade limit', () => {
    const v = checkOrderProposal({ ...proposal, quoteAmount: 999 }, baseCtx)
    expect(v.approvedQuote).toBe(DEFAULT_GUARDIAN_CONFIG.perTradeQuoteCap)
  })

  it('blocks when at the position cap', () => {
    const v = checkOrderProposal(proposal, { ...baseCtx, openPositions: 4 })
    expect(v.allowed).toBe(false)
    expect(v.blocks.some((b) => b.rule === 'position_cap')).toBe(true)
  })

  it('halts for the day past the max daily loss', () => {
    const v = checkOrderProposal(proposal, { ...baseCtx, dailyPnlQuote: -100 })
    expect(v.blocks.some((b) => b.rule === 'daily_loss_halt')).toBe(true)
  })

  it('respects an active loss-streak cooldown', () => {
    const until = new Date(Date.now() + 60_000).toISOString()
    const v = checkOrderProposal(proposal, { ...baseCtx, strategyCooldownUntil: until, now: new Date() })
    expect(v.blocks.some((b) => b.rule === 'loss_streak_cooldown')).toBe(true)
  })

  it('does not block on an expired cooldown', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const v = checkOrderProposal(proposal, { ...baseCtx, strategyCooldownUntil: past })
    expect(v.allowed).toBe(true)
  })

  it('enforces the balance floor', () => {
    const v = checkOrderProposal(proposal, { ...baseCtx, quoteBalance: 510 })
    expect(v.blocks.some((b) => b.rule === 'balance_floor')).toBe(true)
  })
})

describe('helpers', () => {
  it('cooldownUntil is in the future', () => {
    const from = new Date('2026-01-01T00:00:00Z')
    expect(cooldownUntil(DEFAULT_GUARDIAN_CONFIG, from)).toBe('2026-01-01T04:00:00.000Z')
  })
  it('dayKey buckets by UTC date', () => {
    expect(dayKey('2026-07-04T23:59:00Z')).toBe('2026-07-04')
  })
})
