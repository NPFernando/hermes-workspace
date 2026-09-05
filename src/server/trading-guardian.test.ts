import { describe, expect, it } from 'vitest'

import {
  DEFAULT_GUARDIAN_CONFIG,
  checkOrderProposal,
  cooldownUntil,
  dayKey,
  weekKey,
  type GuardianContext,
} from './trading-guardian'

const baseCtx: GuardianContext = {
  openPositions: 0,
  quoteBalance: 5000,
  dailyPnlQuote: 0,
  weeklyPnlQuote: 0,
  openUnrealizedPnlQuote: 0,
  strategyLossStreak: 0,
  strategyCooldownUntil: null,
}
const proposal = {
  symbol: 'BTCUSDT',
  strategyId: 'rsi_reversion',
  quoteAmount: 25,
}

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

  it('halts for the week past the max weekly loss', () => {
    const v = checkOrderProposal(proposal, {
      ...baseCtx,
      weeklyPnlQuote: -DEFAULT_GUARDIAN_CONFIG.maxWeeklyLossQuote,
    })
    expect(v.allowed).toBe(false)
    expect(v.blocks.some((b) => b.rule === 'weekly_loss_halt')).toBe(true)
  })

  it('does not apply the weekly halt while under the limit', () => {
    const v = checkOrderProposal(proposal, { ...baseCtx, weeklyPnlQuote: -10 })
    expect(v.blocks.some((b) => b.rule === 'weekly_loss_halt')).toBe(false)
  })

  it('halts new entries past the max open unrealized drawdown', () => {
    const v = checkOrderProposal(proposal, {
      ...baseCtx,
      openUnrealizedPnlQuote: -DEFAULT_GUARDIAN_CONFIG.maxOpenDrawdownQuote,
    })
    expect(v.allowed).toBe(false)
    expect(v.blocks.some((b) => b.rule === 'open_drawdown_halt')).toBe(true)
  })

  it('does not apply the open-drawdown halt while under the limit', () => {
    const v = checkOrderProposal(proposal, {
      ...baseCtx,
      openUnrealizedPnlQuote: -20,
    })
    expect(v.blocks.some((b) => b.rule === 'open_drawdown_halt')).toBe(false)
  })

  it('respects an active loss-streak cooldown', () => {
    const until = new Date(Date.now() + 60_000).toISOString()
    const v = checkOrderProposal(proposal, {
      ...baseCtx,
      strategyCooldownUntil: until,
      now: new Date(),
    })
    expect(v.blocks.some((b) => b.rule === 'loss_streak_cooldown')).toBe(true)
  })

  it('does not block on an expired cooldown', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    const v = checkOrderProposal(proposal, {
      ...baseCtx,
      strategyCooldownUntil: past,
    })
    expect(v.allowed).toBe(true)
  })

  it('enforces the balance floor', () => {
    const v = checkOrderProposal(proposal, { ...baseCtx, quoteBalance: 510 })
    expect(v.blocks.some((b) => b.rule === 'balance_floor')).toBe(true)
  })

  it('ignores bucket exposure when correlationBucketsEnabled is off (default)', () => {
    const v = checkOrderProposal(proposal, {
      ...baseCtx,
      bucketExposureQuote: { majors: 999 },
    })
    expect(v.blocks.some((b) => b.rule === 'bucket_exposure_cap')).toBe(false)
  })

  it('blocks when correlated bucket exposure would breach the cap', () => {
    const config = {
      ...DEFAULT_GUARDIAN_CONFIG,
      correlationBucketsEnabled: true,
      maxBucketExposureQuote: 40,
    }
    // BTCUSDT is in the "majors" bucket; existing exposure 30 + this 25-quote
    // proposal (capped at perTradeQuoteCap 50) would reach 55, past the 40 cap.
    const v = checkOrderProposal(
      proposal,
      { ...baseCtx, bucketExposureQuote: { majors: 30 } },
      config,
    )
    expect(v.allowed).toBe(false)
    expect(v.blocks.some((b) => b.rule === 'bucket_exposure_cap')).toBe(true)
  })

  it('allows bucket exposure under the cap', () => {
    const config = {
      ...DEFAULT_GUARDIAN_CONFIG,
      correlationBucketsEnabled: true,
      maxBucketExposureQuote: 100,
    }
    const v = checkOrderProposal(
      proposal,
      { ...baseCtx, bucketExposureQuote: { majors: 30 } },
      config,
    )
    expect(v.blocks.some((b) => b.rule === 'bucket_exposure_cap')).toBe(false)
  })

  it('never blocks a symbol not listed in any correlation bucket', () => {
    const config = {
      ...DEFAULT_GUARDIAN_CONFIG,
      correlationBucketsEnabled: true,
      maxBucketExposureQuote: 1,
      correlationBuckets: { majors: ['ETHUSDT'] },
    }
    const v = checkOrderProposal(
      proposal,
      { ...baseCtx, bucketExposureQuote: { majors: 999 } },
      config,
    )
    expect(v.blocks.some((b) => b.rule === 'bucket_exposure_cap')).toBe(false)
  })
})

describe('helpers', () => {
  it('cooldownUntil is in the future', () => {
    const from = new Date('2026-01-01T00:00:00Z')
    expect(cooldownUntil(DEFAULT_GUARDIAN_CONFIG, from)).toBe(
      '2026-01-01T04:00:00.000Z',
    )
  })
  it('dayKey buckets by UTC date', () => {
    expect(dayKey('2026-07-04T23:59:00Z')).toBe('2026-07-04')
  })
  it('weekKey buckets by UTC ISO week', () => {
    // 2026-01-01 is a Thursday -> ISO week 1.
    expect(weekKey('2026-01-01T00:00:00Z')).toBe('2026-W01')
    // Same ISO week -> same key; different week -> different key (UTC boundaries).
    expect(weekKey('2026-07-06T00:00:00Z')).toBe(
      weekKey('2026-07-10T23:00:00Z'),
    )
    expect(weekKey('2026-07-05T00:00:00Z')).not.toBe(
      weekKey('2026-07-13T00:00:00Z'),
    )
    // Year boundary: 2026-12-31 (Thu) and 2027-01-01 (Fri) share ISO week 2026-W53,
    // so losses straddling Jan 1 bucket together.
    expect(weekKey('2026-12-31T12:00:00Z')).toBe('2026-W53')
    expect(weekKey('2027-01-01T12:00:00Z')).toBe('2026-W53')
  })
})
