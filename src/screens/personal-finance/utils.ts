// M2: digit grouping is locale-specific (e.g. LKR/AUD/USD group in thousands,
// INR in lakhs). Key the grouping locale off the currency instead of hardcoding
// 'en-LK' for everything; fall back to 'en-LK' for currencies not listed.
const CURRENCY_LOCALE: Record<string, string> = {
  LKR: 'en-LK',
  AUD: 'en-AU',
  USD: 'en-US',
  INR: 'en-IN',
  EUR: 'de-DE',
  GBP: 'en-GB',
}

export function formatMoney(amount: number, currency: string): string {
  const locale = CURRENCY_LOCALE[currency] ?? 'en-LK'
  return `${currency} ${Math.round(amount).toLocaleString(locale)}`
}

/**
 * PF-201: formats a base-currency amount. The name is historical — the value is
 * expressed in the payload's configured `baseCurrency` (default 'LKR', in which
 * case this is unchanged). Pass `payload.baseCurrency` at call sites that have it.
 */
export function formatLkr(value: number, currency: string = 'LKR'): string {
  return formatMoney(value, currency)
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

// `computeAccountLedgerBalance` + `ReconcileTransaction` moved to
// `src/server/finance-store.ts` (they now need the FX table for
// cross-currency legs, and `financeSummary` uses them). The accounts panel
// reads the server-computed `ledgerBalance` off each payload account row.
