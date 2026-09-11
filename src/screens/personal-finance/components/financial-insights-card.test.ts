import { describe, expect, it } from 'vitest'
import { buildFinancialInsights } from './financial-insights-card'
import type { PersonalFinancePayload } from '../types'

function payload(overrides: Partial<PersonalFinancePayload> = {}): PersonalFinancePayload {
  return {
    ok: true,
    netWorthSnapshots: [],
    financialRules: {},
    summary: {
      netWorthLkr: 0,
      cashBalanceLkr: 0,
      netSavingsLkr: 0,
      savingsRate: 0,
      totalIncomeLkr: 0,
      totalExpensesLkr: 0,
      taxReserveLkr: 0,
      stockHoldingsValueLkr: 0,
      fixedDepositsValueLkr: 0,
      debtLkr: 0,
      liquidNetWorthLkr: 0,
      lockedWealthLkr: 0,
      unrealizedStockPnlLkr: 0,
      unrealizedStockPnlPct: 0,
      accountCount: 0,
    },
    budgetVsActual: [],
    budgetAlertThresholdPct: 80,
    annualBudgetVsActual: [],
    exchangeRates: [],
    safeToSpend: { cashLkr: 0, reserveLkr: 0, committedLkr: 0, amountLkr: 0, configured: false, basis: '' },
    transactions: [],
    deletedTransactions: [],
    backupHealth: { status: 'missing', configured: false, backupCount: 0, latestCreatedAt: null, latestAgeMs: null, staleAfterMs: 0, retention: 7 },
    financialHealth: {
      score: 80,
      band: 'stable',
      components: [
        { key: 'savings', label: 'Savings', score: 20, maxScore: 25, detail: 'Good' },
        { key: 'emergency', label: 'Emergency fund', score: 20, maxScore: 25, detail: 'Good' },
        { key: 'budget', label: 'Budget', score: 20, maxScore: 20, detail: 'Good' },
        { key: 'debt', label: 'Debt', score: 10, maxScore: 15, detail: 'Good' },
        { key: 'data', label: 'Data', score: 10, maxScore: 15, detail: 'Good' },
      ],
    },
    alerts: [],
    emergencyFund: { targetMonths: 0, avgMonthlyExpensesLkr: 0, currentLkr: 0, targetLkr: 0, coverageMonths: 0, progressPct: 0 },
    savingsRateTarget: { targetPct: 0, actualPct: 0, progressPct: 0, hasData: false },
    wealthGoal: { targetLkr: 0, targetDate: null, currentLkr: 0, progressPct: 0 },
    financeQaHistory: [],
    storage: {} as PersonalFinancePayload['storage'],
    ...overrides,
  } as unknown as PersonalFinancePayload
}

describe('buildFinancialInsights', () => {
  it('prioritizes explicit critical alerts and safe-to-spend risk', () => {
    const insights = buildFinancialInsights(payload({
      alerts: [{ level: 'critical', title: 'Cash shortfall', detail: 'Review cash.' }],
      safeToSpend: { cashLkr: 10, reserveLkr: 20, committedLkr: 5, amountLkr: -15, configured: true, basis: 'test' },
    }))
    expect(insights[0]).toMatchObject({ level: 'critical', title: 'Cash shortfall' })
    expect(insights.some((insight) => insight.title === 'Safe-to-spend estimate is negative')).toBe(true)
  })

  it('returns a neutral insight when evidence has no priority issue', () => {
    expect(buildFinancialInsights(payload())).toEqual([
      expect.objectContaining({ level: 'info', title: 'No priority issue detected' }),
    ])
  })
})
