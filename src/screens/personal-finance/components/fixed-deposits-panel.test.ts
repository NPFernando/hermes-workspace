import { describe, expect, it } from 'vitest'
import {
  estimatedAccruedInterest,
  estimatedMaturityValue,
  buildFixedDepositLadder,
  nextInterestPayoutDate,
} from './fixed-deposits-panel'

describe('estimatedMaturityValue', () => {
  it('calculates a transparent simple-interest maturity estimate', () => {
    expect(
      estimatedMaturityValue(100_000, 12, '2026-01-01', '2027-01-01'),
    ).toBeCloseTo(112_000, 0)
  })

  it('returns null for invalid or reversed dates', () => {
    expect(estimatedMaturityValue(100_000, 12, '2027-01-01', '2026-01-01')).toBeNull()
    expect(estimatedMaturityValue(-1, 12, '2026-01-01', '2027-01-01')).toBeNull()
  })

  it('caps accrued interest at maturity and supports a deterministic as-of date', () => {
    expect(
      estimatedAccruedInterest(
        100_000,
        12,
        '2026-01-01',
        '2027-01-01',
        new Date('2026-07-02T00:00:00.000Z'),
      ),
    ).toBeCloseTo(5_983.56, 2)
    expect(
      estimatedAccruedInterest(
        100_000,
        12,
        '2026-01-01',
        '2027-01-01',
        new Date('2028-01-01T00:00:00.000Z'),
      ),
    ).toBeCloseTo(12_000, 0)
  })

  it('finds the next monthly, quarterly, and maturity payout within the term', () => {
    const asOf = new Date('2026-03-15T00:00:00.000Z')
    expect(
      nextInterestPayoutDate('2026-01-31', '2026-12-31', 'monthly', asOf),
    ).toBe('2026-03-31')
    expect(
      nextInterestPayoutDate('2026-01-01', '2026-12-31', 'quarterly', asOf),
    ).toBe('2026-04-01')
    expect(
      nextInterestPayoutDate('2026-01-01', '2026-12-31', 'at_maturity', asOf),
    ).toBe('2026-12-31')
    expect(
      nextInterestPayoutDate(
        '2026-01-01',
        '2026-02-01',
        'monthly',
        new Date('2026-03-01T00:00:00.000Z'),
      ),
    ).toBeNull()
  })

  it('sorts valid deposits chronologically for the maturity ladder', () => {
    const ladder = buildFixedDepositLadder([
      { id: 'later', bankName: 'Zeta', maturityDate: '2027-06-01', principal: 20_000 },
      { id: 'earlier', bankName: 'Alpha', maturityDate: '2027-01-15', principal: 10_000, autoRenew: true },
      { id: 'invalid', bankName: 'Ignored', maturityDate: 'not-a-date', principal: 99_000 },
    ])
    expect(ladder.map((entry) => entry.id)).toEqual(['earlier', 'later'])
    expect(ladder[0].autoRenew).toBe(true)
  })
})
