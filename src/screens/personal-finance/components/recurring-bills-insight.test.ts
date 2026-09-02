import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { detectRecurringVendors } from './recurring-bills-insight'

describe('detectRecurringVendors', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 2, 15)) // March 15, 2026
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('flags a vendor seen with a similar amount across 2+ of the last 3 months', () => {
    const expenses = [
      {
        date: '2026-01-05',
        vendor: 'Netflix',
        category: 'Subscriptions',
        amount: 1500,
        convertedLkrAmount: 1500,
      },
      {
        date: '2026-02-05',
        vendor: 'Netflix',
        category: 'Subscriptions',
        amount: 1500,
        convertedLkrAmount: 1500,
      },
      {
        date: '2026-03-05',
        vendor: 'Netflix',
        category: 'Subscriptions',
        amount: 1550,
        convertedLkrAmount: 1550,
      },
    ]
    const result = detectRecurringVendors(expenses)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      vendor: 'netflix',
      category: 'Subscriptions',
      monthsSeen: 3,
    })
  })

  it('does not flag a one-off vendor seen only once', () => {
    const expenses = [
      {
        date: '2026-03-05',
        vendor: 'OneTimeShop',
        category: 'Shopping',
        amount: 5000,
        convertedLkrAmount: 5000,
      },
    ]
    expect(detectRecurringVendors(expenses)).toHaveLength(0)
  })

  it('does not flag a vendor whose amount varies too much between months', () => {
    const expenses = [
      {
        date: '2026-01-05',
        vendor: 'Groceries Inc',
        category: 'Groceries',
        amount: 1000,
        convertedLkrAmount: 1000,
      },
      {
        date: '2026-02-05',
        vendor: 'Groceries Inc',
        category: 'Groceries',
        amount: 5000,
        convertedLkrAmount: 5000,
      },
    ]
    expect(detectRecurringVendors(expenses)).toHaveLength(0)
  })

  it('ignores records outside the lookback window', () => {
    const expenses = [
      {
        date: '2025-10-05',
        vendor: 'OldVendor',
        category: 'Other',
        amount: 1000,
        convertedLkrAmount: 1000,
      },
      {
        date: '2025-11-05',
        vendor: 'OldVendor',
        category: 'Other',
        amount: 1000,
        convertedLkrAmount: 1000,
      },
    ]
    expect(detectRecurringVendors(expenses, 3)).toHaveLength(0)
  })

  it('matches vendors case-insensitively', () => {
    const expenses = [
      {
        date: '2026-01-05',
        vendor: 'spotify',
        category: 'Subscriptions',
        amount: 500,
        convertedLkrAmount: 500,
      },
      {
        date: '2026-02-05',
        vendor: 'Spotify',
        category: 'Subscriptions',
        amount: 500,
        convertedLkrAmount: 500,
      },
    ]
    const result = detectRecurringVendors(expenses)
    expect(result).toHaveLength(1)
    expect(result[0].monthsSeen).toBe(2)
  })
})
