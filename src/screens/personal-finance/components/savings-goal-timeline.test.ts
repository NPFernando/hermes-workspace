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
})
