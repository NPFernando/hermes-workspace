import { describe, expect, it } from 'vitest'
import { buildBudgetRollover, buildCommittedSpend, buildProjectedSpend } from './budget-panel'

describe('buildProjectedSpend', () => {
  it('projects current-month run rate and future recurring entries', () => {
    const rows = buildProjectedSpend(
      '2026-09',
      [{ category: 'Food', currency: 'LKR', budget: 30_000, actual: 10_000 }],
      [
        {
          date: '2026-09-25',
          category: 'Food',
          convertedLkrAmount: 2_000,
          recurring: true,
        },
        {
          date: '2026-09-26',
          category: 'Food',
          convertedLkrAmount: 200_000,
          recurring: true,
          deletedAt: '2026-09-27T00:00:00Z',
        },
        {
          date: '2026-09-27',
          category: 'Food',
          convertedLkrAmount: 300_000,
          recurring: true,
          transactionType: 'transfer',
        },
      ],
      new Date('2026-09-10T12:00:00.000Z'),
    )
    expect(rows[0].projected).toBe(30_000)
    expect(rows[0].variance).toBe(0)
    expect(rows[0].percentUsed).toBe(100)
  })

  it('does not project non-LKR budgets into the LKR view', () => {
    expect(
      buildProjectedSpend(
        '2026-09',
        [{ category: 'Travel', currency: 'USD', budget: 100, actual: 20 }],
        [],
        new Date('2026-09-10T12:00:00.000Z'),
      ),
    ).toEqual([])
  })
})

describe('buildCommittedSpend', () => {
  it('counts only recurring LKR expenses and groups categories', () => {
    expect(
      buildCommittedSpend('2026-09', [
        { date: '2026-09-02', category: 'Rent', currency: 'LKR', convertedLkrAmount: 50_000, recurring: true },
        { date: '2026-09-03', category: 'Rent', currency: 'LKR', convertedLkrAmount: 5_000, recurring: true },
        { date: '2026-09-04', category: 'Travel', currency: 'USD', convertedLkrAmount: 10_000, recurring: true },
        { date: '2026-08-04', category: 'Food', currency: 'LKR', convertedLkrAmount: 20_000, recurring: true },
      ]),
    ).toEqual({
      totalLkr: 55_000,
      categories: [{ category: 'Rent', amountLkr: 55_000 }],
    })
  })
  it('ignores deleted and transfer commitments', () => {
    expect(buildCommittedSpend('2026-09', [
      { date: '2026-09-02', category: 'Rent', currency: 'LKR', convertedLkrAmount: 50_000, recurring: true, deletedAt: '2026-09-03T00:00:00Z' },
      { date: '2026-09-03', category: 'Rent', currency: 'LKR', convertedLkrAmount: 90_000, recurring: true, transactionType: 'transfer' },
      { date: '2026-09-04', category: 'Rent', currency: 'LKR', convertedLkrAmount: 5_000, recurring: true },
    ])).toEqual({ totalLkr: 5_000, categories: [{ category: 'Rent', amountLkr: 5_000 }] })
  })
})

describe('buildBudgetRollover', () => {
  it('carries forward only unused prior-month LKR budget', () => {
    expect(
      buildBudgetRollover(
        '2026-09',
        [{ category: 'Food', currency: 'LKR', budget: 30_000 }],
        [{ month: '2026-08', category: 'Food', currency: 'LKR', budgetAmount: 20_000 }],
        [{ date: '2026-08-10', category: 'Food', currency: 'LKR', convertedLkrAmount: 12_000 }],
      ),
    ).toEqual([{ category: 'Food', budget: 30_000, rollover: 8_000, available: 38_000 }])
  })
})
