export function formatMoney(amount: number, currency: string): string {
  return `${currency} ${Math.round(amount).toLocaleString('en-LK')}`
}

export function formatLkr(value: number): string {
  return formatMoney(value, 'LKR')
}

export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}

export type FinanceAnswerChartExport = {
  title: string
  data: Array<{ label: string; value: number }>
}

/**
 * AI-207: builds a shareable markdown report from a live Finance Analyst
 * answer (question/answer/optional chart) — reuses the exact
 * generate-markdown-then-download-or-copy shape already used by
 * ExportMissionButton (src/screens/gateway/components/export-mission.tsx).
 * Chart values are formatted via formatLkr since every number produced by
 * buildFinanceQueryContext() (finance-store.ts) is already LKR-converted.
 */
export function buildFinanceAnswerMarkdown(
  question: string,
  answer: string,
  chart: FinanceAnswerChartExport | null,
): string {
  const lines: Array<string> = []
  lines.push('# Finance Analyst')
  lines.push('')
  lines.push(`**Q:** ${question}`)
  lines.push('')
  lines.push(answer)

  if (chart) {
    lines.push('')
    lines.push(`## ${chart.title}`)
    lines.push('')
    lines.push('| Label | Value |')
    lines.push('|---|---|')
    for (const row of chart.data) {
      lines.push(`| ${row.label} | ${formatLkr(row.value)} |`)
    }
  }

  lines.push('')
  lines.push('---')
  lines.push(
    `*Exported ${new Date().toLocaleString()} from Hermes Workspace — Personal Finance*`,
  )

  return lines.join('\n')
}

export type ReconcileTransaction = {
  accountId?: string
  currency: string
  amount: number
  kind: 'income' | 'expense'
}

/**
 * AI-600 (Phase 28, first slice): reconciles an account's manually-maintained
 * `balance` against what its own tagged transactions say it should be,
 * starting from `openingBalance`. Returns null when there's no
 * openingBalance to start from — without one, "since some unknown point"
 * transactions can't be meaningfully checked, so no number is shown rather
 * than a misleading one. Only same-currency transactions are summed;
 * cross-currency records tagged to the account are excluded (no conversion
 * attempted this slice).
 */
export function computeAccountLedgerBalance(
  account: { id: string; currency: string; openingBalance?: number },
  records: Array<ReconcileTransaction>,
): number | null {
  if (account.openingBalance === undefined) return null
  let balance = account.openingBalance
  for (const record of records) {
    if (record.accountId !== account.id || record.currency !== account.currency)
      continue
    balance += record.kind === 'income' ? record.amount : -record.amount
  }
  return balance
}
