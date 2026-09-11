import { describe, expect, it } from 'vitest'
import { createEmptyFinanceDatabase } from './finance-store'
import { getCashFlowForecast } from './finance-forecast'

describe('getCashFlowForecast', () => {
  it('combines historical averages, scheduled items, reserve, and warnings', () => {
    const db = createEmptyFinanceDatabase()
    db.finance_accounts.push({
      id: 'cash', name: 'Cash', type: 'bank', currency: 'LKR', balance: 100_000,
      source: 'test', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
    })
    db.income_records.push({
      id: 'i', dateReceived: '2026-07-01', sourceName: 'Salary', incomeType: 'Salary',
      originalCurrency: 'LKR', originalAmount: 50_000, exchangeRateUsed: 1,
      convertedLkrAmount: 50_000, taxable: false, source: 'test',
      createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'e', date: '2026-07-02', vendor: 'Rent', category: 'Housing', currency: 'LKR',
      amount: 40_000, convertedLkrAmount: 40_000, recurring: true, workRelated: false,
      taxDeductiblePossible: false, source: 'test', createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    })
    db.scheduled_transactions.push({
      id: 's', dueDate: '2026-10-05', kind: 'expense', counterparty: 'School', category: 'Education',
      amount: 20_000, status: 'pending', source: 'test', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    })
    const forecast = getCashFlowForecast(db, new Date('2026-09-10T00:00:00Z'))
    expect(forecast.months[0]).toMatchObject({ month: '2026-10', expectedIncomeLkr: 50_000, expectedExpenseLkr: 60_000 })
    expect(forecast.safeToSpendLkr).toBe(50_000)
  })
})
