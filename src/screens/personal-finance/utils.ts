export function formatMoney(amount: number, currency: string): string {
  return `${normalizeDisplayCurrency(currency)} ${Math.round(amount).toLocaleString('en-LK')}`
}

/** Canonicalize legacy/display currency values before grouping or rate joins. */
export function normalizeDisplayCurrency(
  value: unknown,
  fallback = 'LKR',
): string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return normalized || fallback
}

export function formatLkr(value: number, currency = 'LKR'): string {
  return formatMoney(value, currency)
}

export function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}

export type ExchangeRateLike = {
  base: string
  target: string
  rate: number
  date?: string
}

/** PF-209: read-only client conversion for exposure displays. */
export function convertWithExchangeRates(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  rates: Array<ExchangeRateLike>,
  asOf = new Date().toISOString().slice(0, 10),
): number | undefined {
  if (fromCurrency === toCurrency) return amount
  const eligible = rates.filter(
    (rate) =>
      Number.isFinite(rate.rate) &&
      rate.rate > 0 &&
      (!rate.date || rate.date <= asOf),
  )
  const latest = (base: string, target: string) => {
    const matches = eligible
      .filter((rate) => rate.base === base && rate.target === target)
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
    return matches.length === 0 ? undefined : matches[0]
  }
  const direct = latest(fromCurrency, toCurrency)
  if (direct) return amount * direct.rate
  const inverse = latest(toCurrency, fromCurrency)
  if (inverse) return amount / inverse.rate
  if (fromCurrency !== 'LKR' && toCurrency !== 'LKR') {
    const fromLkr = latest(fromCurrency, 'LKR')
    const toLkr = latest('LKR', toCurrency)
    if (fromLkr && toLkr) return amount * fromLkr.rate * toLkr.rate
  }
  return undefined
}

export function formatDateTime(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown time'
  return new Intl.DateTimeFormat('en-LK', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatDateOnly(value: string | number | Date): string {
  const date =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00`)
      : value instanceof Date
        ? value
        : new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unknown date'
  return new Intl.DateTimeFormat('en-LK', { dateStyle: 'medium' }).format(date)
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
