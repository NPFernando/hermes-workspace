import { describe, expect, it } from 'vitest'
import { savingsGoalTimeline } from './savings-goal-timeline'

const today = new Date('2026-09-12T00:00:00.000Z')

describe('savingsGoalTimeline', () => {
  it('projects months and a calendar date without assuming investment returns', () => {
    expect(
      savingsGoalTimeline(
        {
          currentAmount: 20_000,
          targetAmount: 100_000,
          monthlyContribution: 15_000,
        },
        today,
      ),
    ).toEqual({
      state: 'projected',
      monthsRemaining: 6,
      projectedDate: '2027-03-12',
      requiredMonthlyContribution: null,
      targetDateMonths: null,
      optimisticMonthsRemaining: null,
      optimisticDate: null,
      pessimisticMonthsRemaining: null,
      pessimisticDate: null,
    })
  })

  it('compares the current contribution with an optional target date', () => {
    expect(
      savingsGoalTimeline(
        {
          currentAmount: 0,
          targetAmount: 120_000,
          monthlyContribution: 10_000,
          targetDate: '2027-09-01',
        },
        today,
      ),
    ).toMatchObject({
      state: 'projected',
      monthsRemaining: 12,
      requiredMonthlyContribution: 10_000,
      targetDateMonths: 12,
    })
  })

  it('identifies achieved, paused, and unconfigured goals', () => {
    expect(
      savingsGoalTimeline({
        currentAmount: 100,
        targetAmount: 100,
        monthlyContribution: 0,
      }),
    ).toEqual({ state: 'achieved' })
    expect(
      savingsGoalTimeline({
        currentAmount: 0,
        targetAmount: 100,
        monthlyContribution: 10,
        status: 'paused',
      }),
    ).toEqual({ state: 'paused' })
    expect(
      savingsGoalTimeline({
        currentAmount: 0,
        targetAmount: 100,
        monthlyContribution: 0,
      }),
    ).toEqual({ state: 'no_contribution' })
    expect(
      savingsGoalTimeline({
        currentAmount: 0,
        targetAmount: 0,
        monthlyContribution: 100,
      }),
    ).toEqual({ state: 'no_target' })
  })

  it('clamps month-end dates and ignores malformed target dates', () => {
    const february = savingsGoalTimeline(
      { currentAmount: 0, targetAmount: 10, monthlyContribution: 10 },
      new Date('2026-01-31T00:00:00.000Z'),
    )
    expect(february).toMatchObject({
      state: 'projected',
      projectedDate: '2026-02-28',
    })

    const invalid = savingsGoalTimeline(
      {
        currentAmount: 0,
        targetAmount: 100,
        monthlyContribution: 50,
        targetDate: '2026-02-30',
      },
      today,
    )
    expect(invalid).toMatchObject({
      state: 'projected',
      targetDateMonths: null,
      requiredMonthlyContribution: null,
    })
  })

  describe('volatilityRatio (confidence band)', () => {
    it('omits the band entirely when no ratio is given', () => {
      const result = savingsGoalTimeline(
        { currentAmount: 0, targetAmount: 100_000, monthlyContribution: 10_000 },
        today,
      )
      expect(result).toMatchObject({
        optimisticMonthsRemaining: null,
        optimisticDate: null,
        pessimisticMonthsRemaining: null,
        pessimisticDate: null,
      })
    })

    it('produces a faster optimistic date and a slower pessimistic date', () => {
      // 100,000 remaining at 10,000/month = 10 months baseline.
      const result = savingsGoalTimeline(
        { currentAmount: 0, targetAmount: 100_000, monthlyContribution: 10_000 },
        today,
        0.2, // ±20%
      )
      expect(result).toMatchObject({
        state: 'projected',
        monthsRemaining: 10,
        // 12,000/month -> ceil(100000/12000) = 9 months
        optimisticMonthsRemaining: 9,
        // 8,000/month -> ceil(100000/8000) = 13 months
        pessimisticMonthsRemaining: 13,
      })
      if (result.state === 'projected') {
        expect(result.optimisticDate).not.toBeNull()
        expect(result.pessimisticDate).not.toBeNull()
        expect(result.optimisticDate! < result.projectedDate).toBe(true)
        expect(result.pessimisticDate! > result.projectedDate).toBe(true)
      }
    })

    it('clamps a ratio at or above 1 so pessimistic (zero or negative contribution) stays null', () => {
      const result = savingsGoalTimeline(
        { currentAmount: 0, targetAmount: 100_000, monthlyContribution: 10_000 },
        today,
        1, // a 100% swing would make the "slower" contribution 0
      )
      expect(result).toMatchObject({
        state: 'projected',
        pessimisticMonthsRemaining: null,
        pessimisticDate: null,
      })
      if (result.state === 'projected') {
        expect(result.optimisticMonthsRemaining).not.toBeNull()
      }
    })

    it('clamps a negative ratio to 0, same as omitting it', () => {
      const withNegative = savingsGoalTimeline(
        { currentAmount: 0, targetAmount: 100_000, monthlyContribution: 10_000 },
        today,
        -0.5,
      )
      expect(withNegative).toMatchObject({
        optimisticMonthsRemaining: null,
        pessimisticMonthsRemaining: null,
      })
    })
  })
})
