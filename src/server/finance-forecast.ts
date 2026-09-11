import {
  financeSummary,
  getRecurringBills,
} from './finance-store'
import type { FinanceDatabase } from './finance-store'

export type CashFlowForecast = {
  averageMonthlyIncomeLkr: number
  averageMonthlyExpenseLkr: number
  recurringMonthlyLkr: number
  safeToSpendLkr: number
  months: Array<{
    month: string
    expectedIncomeLkr: number
    expectedExpenseLkr: number
    netLkr: number
    endingCashLkr: number
  }>
  alerts: Array<{ level: 'warning' | 'critical'; detail: string }>
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

function historicalAverages(db: FinanceDatabase, current: string): { income: number; expense: number } {
  const totals = new Map<string, { income: number; expense: number }>()
  for (const row of db.income_records) {
    const month = row.dateReceived.slice(0, 7)
    if (month >= current) continue
    const total = totals.get(month) ?? { income: 0, expense: 0 }
    total.income += row.convertedLkrAmount
    totals.set(month, total)
  }
  for (const row of db.expense_records) {
    const month = row.date.slice(0, 7)
    if (month >= current) continue
    const total = totals.get(month) ?? { income: 0, expense: 0 }
    total.expense += row.convertedLkrAmount
    totals.set(month, total)
  }
  const history = [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-3)
  return history.length
    ? {
        income: history.reduce((sum, [, row]) => sum + row.income, 0) / history.length,
        expense: history.reduce((sum, [, row]) => sum + row.expense, 0) / history.length,
      }
    : { income: 0, expense: 0 }
}

/** Conservative, server-side forward cash-flow view from verified records. */
export function getCashFlowForecast(
  db: FinanceDatabase,
  today = new Date(),
  monthsAhead = 3,
): CashFlowForecast {
  const current = monthKey(today.getUTCFullYear(), today.getUTCMonth() + 1)
  const history = historicalAverages(db, current)
  const averageMonthlyIncomeLkr = history.income
  const averageMonthlyExpenseLkr = history.expense
  const recurringMonthlyLkr = getRecurringBills(db).reduce(
    (sum, bill) => sum + bill.averageAmount,
    0,
  )
  const summary = financeSummary(db)
  let endingCashLkr = summary.cashBalanceBase
  const forecastMonths: CashFlowForecast['months'] = []

  for (let offset = 1; offset <= monthsAhead; offset += 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1))
    const month = monthKey(date.getUTCFullYear(), date.getUTCMonth() + 1)
    const scheduled = db.scheduled_transactions.filter(
      (row) => row.status === 'pending' && row.dueDate.slice(0, 7) === month,
    )
    const scheduledIncome = scheduled
      .filter((row) => row.kind === 'income')
      .reduce((sum, row) => sum + row.amount, 0)
    const scheduledExpense = scheduled
      .filter((row) => row.kind === 'expense')
      .reduce((sum, row) => sum + row.amount, 0)
    const expectedIncomeLkr = averageMonthlyIncomeLkr + scheduledIncome
    const expectedExpenseLkr = averageMonthlyExpenseLkr + scheduledExpense
    const netLkr = expectedIncomeLkr - expectedExpenseLkr
    endingCashLkr += netLkr
    forecastMonths.push({
      month,
      expectedIncomeLkr,
      expectedExpenseLkr,
      netLkr,
      endingCashLkr,
    })
  }

  const reserve = averageMonthlyExpenseLkr
  const safeToSpendLkr = Math.max(
    0,
    Math.min(summary.cashBalanceBase, summary.cashBalanceBase + (forecastMonths[0]?.netLkr ?? 0) - reserve),
  )
  const alerts: CashFlowForecast['alerts'] = forecastMonths
    .filter((row) => row.endingCashLkr < 0)
    .map((row) => ({
      level: 'critical' as const,
      detail: `Projected cash becomes negative in ${row.month}.`,
    }))
  if (safeToSpendLkr === 0 && summary.cashBalanceBase > 0) {
    alerts.push({ level: 'warning', detail: 'No safe discretionary spend remains after the next-month reserve.' })
  }
  return {
    averageMonthlyIncomeLkr,
    averageMonthlyExpenseLkr,
    recurringMonthlyLkr,
    safeToSpendLkr,
    months: forecastMonths,
    alerts,
  }
}
