/**
 * One-click export of all personal-finance data — a safety net now that a
 * meaningful amount of data (including AI contract reviews) lives only in
 * this app. Personal-finance collections only; the trading-only collections
 * stay out of scope.
 *
 * Formats (review finding U7 — JSON alone is a developer artefact):
 *   ?format=json    (default) — full data dump, same as before
 *   ?format=csv     — a spreadsheet of the unified transaction list
 *   ?format=report  — a printable HTML summary (browser Print → Save as PDF)
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import {
  financeSummary,
  getUnifiedTransactions,
  readFinanceStore,
} from '../../server/finance-store'
import type { FinanceDatabase, UnifiedTransaction } from '../../server/finance-store'

function accountNameLookup(db: FinanceDatabase): (id?: string) => string {
  const byId = new Map(
    db.finance_accounts.map((a) => [a.id, a.name] as const),
  )
  return (id?: string) => (id ? (byId.get(id) ?? id) : '')
}

function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function transactionsCsv(db: FinanceDatabase): string {
  const accountName = accountNameLookup(db)
  const header = [
    'date',
    'kind',
    'counterparty',
    'category',
    'subcategory',
    'account',
    'to_account',
    'currency',
    'amount',
    'amount_lkr',
    'status',
    'tags',
    'notes',
    'source',
  ]
  const rows = getUnifiedTransactions(db).map((t: UnifiedTransaction) =>
    [
      t.date,
      t.kind,
      t.counterparty,
      t.category,
      t.subcategory ?? '',
      accountName(t.kind === 'transfer' ? t.fromAccountId : t.accountId),
      t.kind === 'transfer' ? accountName(t.toAccountId) : '',
      t.currency,
      t.amount,
      t.convertedLkrAmount,
      t.status ?? '',
      t.tags ?? '',
      t.notes ?? '',
      t.source,
    ]
      .map(csvCell)
      .join(','),
  )
  return [header.join(','), ...rows].join('\r\n') + '\r\n'
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c] as string,
  )
}

export function reportHtml(db: FinanceDatabase): string {
  const s = financeSummary(db)
  const cur = db.settings.baseCurrency || 'LKR'
  const money = (n: number) =>
    `${cur} ${Math.round(n).toLocaleString('en-LK')}`
  const generatedAt = new Date().toLocaleString()
  const accountName = accountNameLookup(db)
  const txns = getUnifiedTransactions(db).slice(0, 250)

  const stat = (label: string, value: string) =>
    `<div class="stat"><div class="stat-label">${escapeHtml(label)}</div><div class="stat-value">${escapeHtml(value)}</div></div>`

  const rows = txns
    .map(
      (t) => `<tr>
        <td>${escapeHtml(t.date)}</td>
        <td>${escapeHtml(t.kind)}</td>
        <td>${escapeHtml(t.counterparty)}</td>
        <td>${escapeHtml(t.category)}</td>
        <td>${escapeHtml(
          accountName(t.kind === 'transfer' ? t.fromAccountId : t.accountId),
        )}</td>
        <td class="num">${escapeHtml(t.currency)} ${escapeHtml(
          Math.round(t.amount).toLocaleString('en-LK'),
        )}</td>
      </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Personal finance summary — ${escapeHtml(generatedAt)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .muted { color: #666; font-size: 12px; margin-bottom: 24px; }
  .print-hint { background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 8px; padding: 10px 14px; font-size: 12px; margin-bottom: 24px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .stat { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; }
  .stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
  .stat-value { font-size: 18px; font-weight: 600; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; }
  th { background: #f9fafb; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: #6b7280; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  @media print { .print-hint { display: none; } body { margin: 0; } }
</style>
</head>
<body>
  <h1>Personal finance summary</h1>
  <div class="muted">Generated ${escapeHtml(generatedAt)} · figures in ${escapeHtml(cur)}</div>
  <div class="print-hint">Use your browser's <strong>Print → Save as PDF</strong> to keep a PDF copy of this summary.</div>
  <div class="stats">
    ${stat('Net worth', money(s.netWorthBase))}
    ${stat('Cash balance', money(s.cashBalanceBase))}
    ${stat('Income (all-time)', money(s.totalIncomeBase))}
    ${stat('Expenses (all-time)', money(s.totalExpensesBase))}
    ${stat('Net savings', money(s.netSavingsBase))}
    ${stat('Accounts', String(s.accountCount))}
  </div>
  <h2 style="font-size:16px;margin:0 0 8px;">Recent transactions${
    txns.length === 250 ? ' (latest 250)' : ''
  }</h2>
  <table>
    <thead><tr><th>Date</th><th>Kind</th><th>Counterparty</th><th>Category</th><th>Account</th><th class="num">Amount</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`
}

export const Route = createFileRoute('/api/finance-export')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const db = readFinanceStore()
        const format = new URL(request.url).searchParams.get('format') ?? 'json'
        const stamp = new Date().toISOString().slice(0, 10)

        if (format === 'csv') {
          return new Response(transactionsCsv(db), {
            headers: {
              'content-type': 'text/csv; charset=utf-8',
              'content-disposition': `attachment; filename="personal-finance-transactions-${stamp}.csv"`,
            },
          })
        }

        if (format === 'report') {
          return new Response(reportHtml(db), {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
        }

        const exportData = {
          schemaVersion: db.schemaVersion,
          exportedAt: new Date().toISOString(),
          finance_accounts: db.finance_accounts,
          income_records: db.income_records,
          expense_records: db.expense_records,
          transfers: db.transfers,
          budget_categories: db.budget_categories,
          savings_goals: db.savings_goals,
          tax_records: db.tax_records,
          income_sources: db.income_sources,
          stock_holdings: db.stock_holdings,
          fixed_deposits: db.fixed_deposits,
          pending_ingestions: db.pending_ingestions,
        }
        const filename = `personal-finance-export-${stamp}.json`
        return new Response(JSON.stringify(exportData, null, 2), {
          headers: {
            'content-type': 'application/json',
            'content-disposition': `attachment; filename="${filename}"`,
          },
        })
      },
    },
  },
})
