import type { PersonalFinancePayload } from '../types'

type ReportTransaction = Record<string, unknown>

const text = (value: unknown): string =>
  typeof value === 'string' ? value : ''

const amount = (row: ReportTransaction): number => {
  const candidates = [row.convertedLkrAmount, row.amount, row.value]
  const found = candidates.find(
    (value) => typeof value === 'number' && Number.isFinite(value),
  )
  return typeof found === 'number' ? found : 0
}

const dateOf = (row: ReportTransaction): string =>
  text(row.date || row.transactionDate || row.occurredAt || row.createdAt)

const kindOf = (row: ReportTransaction): string =>
  text(row.kind || row.type).toLowerCase()

function isReportableTransaction(row: ReportTransaction): boolean {
  return text(row.transactionType).toLowerCase() !== 'transfer'
}

const quote = (value: string): string => `"${value.replaceAll('"', '""')}"`

/** AUTO-202: deterministic, local-only monthly report from the current payload. */
export function buildMonthlyFinanceReport(
  payload: PersonalFinancePayload,
  month = new Date().toISOString().slice(0, 7),
): string {
  const summary = payload.summary
  const currency = payload.baseCurrency ?? summary.baseCurrency ?? 'LKR'
  const numeric = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  const snapshot = {
    netWorth: numeric(summary.baseSummary?.netWorth ?? summary.netWorthLkr),
    cashBalance: numeric(summary.baseSummary?.cashBalance ?? summary.cashBalanceLkr),
    debt: numeric(summary.baseSummary?.debt ?? summary.debtLkr),
    savingsRate: numeric(summary.baseSummary?.savingsRate ?? summary.savingsRate),
  }
  const monthRows = payload.transactions.filter(
    (row) => dateOf(row).startsWith(month) && isReportableTransaction(row),
  )
  const income = monthRows
    .filter((row) => kindOf(row) === 'income')
    .reduce((sum, row) => sum + Math.abs(amount(row)), 0)
  const expenses = monthRows
    .filter((row) => kindOf(row) === 'expense')
    .reduce((sum, row) => sum + Math.abs(amount(row)), 0)
  const byCategory = new Map<string, number>()
  for (const row of monthRows) {
    if (kindOf(row) !== 'expense') continue
    const category = text(row.category) || 'Uncategorised'
    byCategory.set(category, (byCategory.get(category) ?? 0) + Math.abs(amount(row)))
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  const overBudget = payload.budgetVsActual
    .filter((row) => row.month === month && row.overBudget)
    .sort((a, b) => b.percentUsed - a.percentUsed)

  const lines = [
    `# Monthly finance report — ${month}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Base currency: ${currency}`,
    '',
    '## Snapshot',
    '',
    `- Net worth: ${snapshot.netWorth.toFixed(2)} ${currency}`,
    `- Cash balance: ${snapshot.cashBalance.toFixed(2)} ${currency}`,
    `- Debt: ${snapshot.debt.toFixed(2)} ${currency}`,
    `- Savings rate: ${snapshot.savingsRate.toFixed(2)}%`,
    `- Safe to spend: ${payload.safeToSpend.configured ? `${payload.safeToSpend.amountLkr.toFixed(2)} converted to LKR` : 'not configured'}`,
    '',
    '## Recorded activity (converted to LKR)',
    '',
    `- Income: ${income.toFixed(2)} LKR`,
    `- Expenses: ${expenses.toFixed(2)} LKR`,
    `- Net movement: ${(income - expenses).toFixed(2)} LKR`,
    `- Transactions: ${monthRows.length}`,
    '',
    '## Top expense categories',
    '',
    ...(categories.length === 0
      ? ['- No expense transactions recorded for this month.']
      : categories.map(([category, total]) => `- ${category}: ${total.toFixed(2)} LKR`)),
    '',
    '## Budget exceptions',
    '',
    ...(overBudget.length === 0
      ? ['- No over-budget categories recorded for this month.']
      : overBudget.map((row) => `- ${row.category}: ${row.percentUsed.toFixed(1)}% used (${row.currency})`)),
    '',
    '## Current alerts',
    '',
    ...(payload.alerts.length === 0
      ? ['- No active finance alerts.']
      : payload.alerts.map((alert) => `- [${alert.level}] ${alert.title}: ${alert.detail}`)),
    '',
    '_This report is a read-only summary of recorded data; it is not financial advice._',
  ]
  return lines.join('\n')
}

/** Small CSV export for offline review without exposing raw transaction rows. */
export function buildMonthlyCategoryCsv(
  payload: PersonalFinancePayload,
  month = new Date().toISOString().slice(0, 7),
): string {
  const rows = payload.transactions.filter(
    (row) => dateOf(row).startsWith(month) && isReportableTransaction(row),
  )
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (kindOf(row) !== 'expense') continue
    const category = text(row.category) || 'Uncategorised'
    totals.set(category, (totals.get(category) ?? 0) + Math.abs(amount(row)))
  }
  return [
    'month,category,amount_lkr',
    ...[...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([category, total]) => `${month},${quote(category)},${total.toFixed(2)}`),
  ].join('\n')
}
