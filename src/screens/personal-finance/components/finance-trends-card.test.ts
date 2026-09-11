import { describe, expect, it } from 'vitest'
import {
  buildCategoryData,
  buildTrendData,
  lastNMonths,
  monthLabel,
} from './finance-trends-card'
import { buildIncomeHistory } from './income-history-card'

describe('lastNMonths', () => {
  it('returns n months ending at the given month, oldest first', () => {
    const months = lastNMonths(3, new Date(2026, 2, 15)) // March 2026
    expect(months).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('rolls over a year boundary correctly', () => {
    const months = lastNMonths(3, new Date(2026, 0, 15)) // January 2026
    expect(months).toEqual(['2025-11', '2025-12', '2026-01'])
  })
})

describe('monthLabel', () => {
  it('formats a YYYY-MM string as a short month name', () => {
    expect(monthLabel('2026-01')).toBe('Jan')
    expect(monthLabel('2026-12')).toBe('Dec')
  })
})

describe('buildTrendData', () => {
  it('sums income and expense per month, LKR-converted', () => {
    const months = ['2026-01', '2026-02']
    const income = [
      { dateReceived: '2026-01-05', convertedLkrAmount: 1000 },
      { dateReceived: '2026-01-20', convertedLkrAmount: 500 },
      { dateReceived: '2026-02-01', convertedLkrAmount: 2000 },
    ]
    const expense = [{ date: '2026-01-10', convertedLkrAmount: 300 }]

    const result = buildTrendData(months, income, expense)
    expect(result).toEqual([
      { month: '2026-01', label: 'Jan', income: 1500, expense: 300, net: 1200 },
      { month: '2026-02', label: 'Feb', income: 2000, expense: 0, net: 2000 },
    ])
  })

  it('returns zeros for months with no records', () => {
    const result = buildTrendData(['2026-05'], [], [])
    expect(result).toEqual([
      { month: '2026-05', label: 'May', income: 0, expense: 0, net: 0 },
    ])
  })
})

describe('buildIncomeHistory', () => {
  it('sums recorded income by month and preserves zero months', () => {
    expect(
      buildIncomeHistory(['2026-01', '2026-02'], [
        { dateReceived: '2026-01-05', convertedLkrAmount: 1000 },
        { dateReceived: '2026-01-20', convertedLkrAmount: 500 },
      ]),
    ).toEqual([
      { month: '2026-01', label: 'Jan', amount: 1500 },
      { month: '2026-02', label: 'Feb', amount: 0 },
    ])
  })

  it('excludes deleted and transfer income rows', () => {
    expect(buildIncomeHistory(['2026-01'], [
      { dateReceived: '2026-01-05', convertedLkrAmount: 1000 },
      { dateReceived: '2026-01-10', convertedLkrAmount: 2000, deletedAt: '2026-01-11T00:00:00Z' },
      { dateReceived: '2026-01-15', convertedLkrAmount: 3000, transactionType: 'transfer' },
    ])).toEqual([{ month: '2026-01', label: 'Jan', amount: 1000 }])
  })
})

describe('buildCategoryData', () => {
  it('sums expenses by category for the given month only, sorted descending', () => {
    const expenses = [
      { date: '2026-03-01', category: 'Groceries', convertedLkrAmount: 500 },
      { date: '2026-03-15', category: 'Groceries', convertedLkrAmount: 200 },
      { date: '2026-03-10', category: 'Dining', convertedLkrAmount: 1000 },
      { date: '2026-02-10', category: 'Dining', convertedLkrAmount: 9999 }, // different month, excluded
    ]
    const result = buildCategoryData('2026-03', expenses)
    expect(result).toEqual([
      { category: 'Dining', amount: 1000 },
      { category: 'Groceries', amount: 700 },
    ])
  })

  it('defaults a missing category to "Other"', () => {
    const result = buildCategoryData('2026-03', [
      { date: '2026-03-01', convertedLkrAmount: 50 },
    ])
    expect(result).toEqual([{ category: 'Other', amount: 50 }])
  })

  it('excludes deleted and transfer legs from chart totals', () => {
    const trend = buildTrendData(
      ['2026-03'],
      [
        { dateReceived: '2026-03-01', convertedLkrAmount: 1000 },
        { dateReceived: '2026-03-02', convertedLkrAmount: 9000, deletedAt: '2026-03-03T00:00:00Z' },
        { dateReceived: '2026-03-03', convertedLkrAmount: 8000, transactionType: 'transfer' },
      ],
      [
        { date: '2026-03-04', category: 'Food', convertedLkrAmount: 500 },
        { date: '2026-03-05', category: 'Food', convertedLkrAmount: 700, deletedAt: '2026-03-06T00:00:00Z' },
        { date: '2026-03-06', category: 'Food', convertedLkrAmount: 900, transactionType: 'transfer' },
      ],
    )
    expect(trend[0]).toMatchObject({ income: 1000, expense: 500, net: 500 })
    expect(buildCategoryData('2026-03', [
      { date: '2026-03-04', category: 'Food', convertedLkrAmount: 500 },
      { date: '2026-03-05', category: 'Food', convertedLkrAmount: 700, deletedAt: '2026-03-06T00:00:00Z' },
      { date: '2026-03-06', category: 'Food', convertedLkrAmount: 900, transactionType: 'transfer' },
    ])).toEqual([{ category: 'Food', amount: 500 }])
  })

  it('caps the result at 8 categories', () => {
    const expenses = Array.from({ length: 12 }, (_, i) => ({
      date: '2026-03-01',
      category: `Cat${i}`,
      convertedLkrAmount: i + 1,
    }))
    expect(buildCategoryData('2026-03', expenses)).toHaveLength(8)
  })
})
