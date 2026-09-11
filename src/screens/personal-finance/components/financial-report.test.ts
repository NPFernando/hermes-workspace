import { describe, expect, it } from 'vitest'
import { buildMonthlyCategoryCsv, buildMonthlyFinanceReport } from './financial-report'
import type { PersonalFinancePayload } from '../types'

const payload = (overrides: Partial<PersonalFinancePayload> = {}) => ({
  summary: {
    netWorthLkr: 1000, cashBalanceLkr: 700, debtLkr: 100, savingsRate: 20,
    totalIncomeLkr: 500, totalExpensesLkr: 400, taxReserveLkr: 0,
    stockHoldingsValueLkr: 0, fixedDepositsValueLkr: 0, liquidNetWorthLkr: 600,
    lockedWealthLkr: 400, unrealizedStockPnlLkr: 0, unrealizedStockPnlPct: 0,
    accountCount: 1,
  },
  baseCurrency: 'LKR',
  transactions: [
    { date: '2026-09-04', kind: 'expense', category: 'Food', amount: 40 },
    { date: '2026-09-05', kind: 'expense', category: 'Food', amount: 10 },
    { date: '2026-09-06', kind: 'income', category: 'Salary', amount: 100 },
    { date: '2026-08-31', kind: 'expense', category: 'Old', amount: 999 },
  ],
  budgetVsActual: [],
  safeToSpend: { configured: true, amountLkr: 250 },
  alerts: [],
  ...overrides,
} as PersonalFinancePayload)

describe('monthly finance report', () => {
  it('summarises only the requested month and aggregates categories', () => {
    const report = buildMonthlyFinanceReport(payload(), '2026-09')
    expect(report).toContain('- Income: 100.00 LKR')
    expect(report).toContain('- Expenses: 50.00 LKR')
    expect(report).toContain('- Food: 50.00 LKR')
    expect(report).toContain('- Safe to spend: 250.00 converted to LKR')
    expect(report).toContain('## Recorded activity (converted to LKR)')
    expect(report).not.toContain('LKR-normalized')
    expect(report).not.toContain('Old')
  })

  it('exports safe category-only CSV with quoted labels', () => {
    const csv = buildMonthlyCategoryCsv(payload({
      transactions: [{ date: '2026-09-01', kind: 'expense', category: 'Food, home', amount: 12 }],
    }), '2026-09')
    expect(csv).toBe('month,category,amount_lkr\n2026-09,"Food, home",12.00')
  })

  it('excludes transfer legs from report totals and category export', () => {
    const report = buildMonthlyFinanceReport(payload({
      transactions: [
        { date: '2026-09-01', kind: 'expense', category: 'Food', amount: 12 },
        { date: '2026-09-02', kind: 'expense', category: 'Transfer', amount: 500, transactionType: 'transfer' },
        { date: '2026-09-02', kind: 'income', category: 'Transfer', amount: 500, transactionType: 'transfer' },
      ],
    }), '2026-09')
    expect(report).toContain('- Expenses: 12.00 LKR')
    expect(report).toContain('- Transactions: 1')
    expect(buildMonthlyCategoryCsv(payload({
      transactions: [
        { date: '2026-09-01', kind: 'expense', category: 'Food', amount: 12 },
        { date: '2026-09-02', kind: 'expense', category: 'Transfer', amount: 500, transactionType: 'transfer' },
      ],
    }), '2026-09')).toBe('month,category,amount_lkr\n2026-09,"Food",12.00')
  })
})
