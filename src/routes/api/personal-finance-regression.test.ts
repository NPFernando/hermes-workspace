import { describe, expect, it } from 'vitest'
import {
  annualBudgetVsActualSummary,
  buildFinanceAgentContext,
  budgetVsActualSummary,
  createEmptyFinanceDatabase,
  financeSummary,
  financialHealthSummary,
  getMonthlySummary,
  normalizeCurrencyCode,
  safeToSpendSummary,
} from './finance-store'

describe('personal-finance calculation regression suite', () => {
  it('keeps the income, expense, and savings identities consistent', () => {
    const db = createEmptyFinanceDatabase()
    db.income_records.push({
      id: 'income-regression', dateReceived: '2025-01-15', sourceName: 'Salary', incomeType: 'Salary',
      originalCurrency: 'LKR', originalAmount: 100_000, exchangeRateUsed: 1, convertedLkrAmount: 100_000,
      taxable: true, source: 'regression', createdAt: '2025-01-15T00:00:00.000Z', updatedAt: '2025-01-15T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'expense-regression', date: '2025-01-20', vendor: 'Grocer', category: 'Groceries', currency: 'LKR',
      amount: 30_000, convertedLkrAmount: 30_000, recurring: false, workRelated: false, taxDeductiblePossible: false,
      source: 'regression', createdAt: '2025-01-20T00:00:00.000Z', updatedAt: '2025-01-20T00:00:00.000Z',
    })
    const summary = financeSummary(db)
    expect(summary.totalIncomeLkr - summary.totalExpensesLkr).toBe(summary.netSavingsLkr)
    expect(summary.savingsRate).toBe((summary.netSavingsLkr / summary.totalIncomeLkr) * 100)
    expect(getMonthlySummary(db)).toEqual([
      { year: 2025, month: 1, income: 100_000, expense: 30_000, savings: 70_000 },
    ])
  })

  it('keeps budget variance, percentage, and annual rollup consistent', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push(
      { id: 'budget-jan', month: '2025-01', category: 'Groceries', currency: 'LKR', budgetAmount: 50_000, source: 'regression', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' },
      { id: 'budget-feb', month: '2025-02', category: 'Groceries', currency: 'LKR', budgetAmount: 50_000, source: 'regression', createdAt: '2025-02-01T00:00:00.000Z', updatedAt: '2025-02-01T00:00:00.000Z' },
    )
    db.expense_records.push({
      id: 'expense-budget-regression', date: '2025-01-20', vendor: 'Grocer', category: 'Groceries', currency: 'LKR',
      amount: 60_000, convertedLkrAmount: 60_000, recurring: false, workRelated: false, taxDeductiblePossible: false,
      source: 'regression', createdAt: '2025-01-20T00:00:00.000Z', updatedAt: '2025-01-20T00:00:00.000Z',
    })
    const [monthly] = budgetVsActualSummary(db, '2025-01')
    const [annual] = annualBudgetVsActualSummary(db, 2025)
    expect(monthly).toMatchObject({ budget: 50_000, actual: 60_000, variance: -10_000, percentUsed: 120, overBudget: true })
    expect(annual).toMatchObject({ budget: 100_000, actual: 60_000, variance: 40_000, monthsTracked: 2, percentUsed: 60, overBudget: false })
  })

  it('excludes soft-deleted expenses from budget actuals', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push({
      id: 'budget-deleted', month: '2025-01', category: 'Groceries', currency: 'LKR', budgetAmount: 50_000,
      source: 'regression', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'expense-deleted', date: '2025-01-05', vendor: 'Grocer', category: 'Groceries', currency: 'LKR', amount: 60_000,
      convertedLkrAmount: 60_000, recurring: false, workRelated: false, taxDeductiblePossible: false, deletedAt: '2025-01-06T00:00:00.000Z',
      source: 'regression', createdAt: '2025-01-05T00:00:00.000Z', updatedAt: '2025-01-06T00:00:00.000Z',
    })
    expect(budgetVsActualSummary(db, '2025-01')[0]).toMatchObject({ actual: 0, variance: 50_000, overBudget: false })
  })

  it('compares non-LKR budgets in their own currency when dated FX exists', () => {
    const db = createEmptyFinanceDatabase()
    db.exchange_rates.push({ base: 'LKR', target: 'USD', rate: 0.003, date: '2025-01-01' })
    db.budget_categories.push({
      id: 'budget-usd', month: '2025-01', category: 'Travel', currency: 'USD', budgetAmount: 100,
      source: 'regression', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'expense-usd', date: '2025-01-05', vendor: 'Airline', category: 'Travel', currency: 'LKR', amount: 30_000,
      convertedLkrAmount: 30_000, recurring: false, workRelated: false, taxDeductiblePossible: false,
      source: 'regression', createdAt: '2025-01-05T00:00:00.000Z', updatedAt: '2025-01-05T00:00:00.000Z',
    })
    expect(budgetVsActualSummary(db, '2025-01')[0]).toMatchObject({ actual: 90, variance: 10, percentUsed: 90, actualConversionAvailable: true })
  })

  it('propagates missing FX state through annual budget rollups', () => {
    const db = createEmptyFinanceDatabase()
    db.budget_categories.push({
      id: 'budget-annual-usd', month: '2025-01', category: 'Travel', currency: 'USD', budgetAmount: 100,
      source: 'regression', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    })
    db.expense_records.push({
      id: 'expense-annual-lkr', date: '2025-01-05', vendor: 'Airline', category: 'Travel', currency: 'LKR', amount: 30_000,
      convertedLkrAmount: 30_000, recurring: false, workRelated: false, taxDeductiblePossible: false,
      source: 'regression', createdAt: '2025-01-05T00:00:00.000Z', updatedAt: '2025-01-05T00:00:00.000Z',
    })
    expect(annualBudgetVsActualSummary(db, 2025)[0]).toMatchObject({
      budget: 100, actual: 0, actualConversionAvailable: false,
    })
  })

  it('never reports negative safe-to-spend or out-of-range health components', () => {
    const db = createEmptyFinanceDatabase()
    db.finance_accounts.push({ id: 'cash-regression', name: 'Cash', type: 'cash', currency: 'LKR', balance: 10_000, source: 'regression', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z' })
    db.settings.minimumCashReserveLkr = 25_000
    expect(safeToSpendSummary(db).amountLkr).toBe(0)
    const health = financialHealthSummary(db)
    expect(health.score).toBeGreaterThanOrEqual(0)
    expect(health.score).toBeLessThanOrEqual(100)
    for (const component of health.components) {
      expect(component.score).toBeGreaterThanOrEqual(0)
      expect(component.score).toBeLessThanOrEqual(component.maxScore)
    }
  })

  it('keeps the finance-agent contract aggregated and bounded', () => {
    const db = createEmptyFinanceDatabase()
    db.ai_tasks.push({
      id: 'task-regression', auditCorrelationId: 'audit-regression', title: 'Review', taskType: 'budget_review',
      status: 'awaiting_approval', risk: 'high', requestedAction: 'summarize', inputSummary: 'aggregated data',
      approvalRequired: true, source: 'regression', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
    })
    const context = buildFinanceAgentContext(db)
    expect(context.contextVersion).toBe('finance-agent-v1')
    expect(context.data.aiTaskSummary).toMatchObject({ total: 1, awaitingApproval: 1, highRisk: 1 })
    expect(context.excludedFields).toContain('raw income/expense transaction rows')
    expect(JSON.stringify(context)).not.toContain('task-regression')
  })

  it('normalizes currency codes before they participate in joins', () => {
    expect(normalizeCurrencyCode(' usd ')).toBe('USD')
    expect(normalizeCurrencyCode('', 'AUD')).toBe('AUD')
    expect(normalizeCurrencyCode(undefined)).toBe('LKR')
  })
})
