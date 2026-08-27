import { describe, expect, it } from 'vitest'
import { buildCategoryData, buildTrendData, lastNMonths, monthLabel } from './finance-trends-card'

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
      { month: '2026-01', label: 'Jan', income: 1500, expense: 300 },
      { month: '2026-02', label: 'Feb', income: 2000, expense: 0 },
    ])
  })

  it('returns zeros for months with no records', () => {
    const result = buildTrendData(['2026-05'], [], [])
    expect(result).toEqual([{ month: '2026-05', label: 'May', income: 0, expense: 0 }])
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
    const result = buildCategoryData('2026-03', [{ date: '2026-03-01', convertedLkrAmount: 50 }])
    expect(result).toEqual([{ category: 'Other', amount: 50 }])
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
