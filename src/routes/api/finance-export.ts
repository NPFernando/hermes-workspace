/**
 * One-click export of all personal-finance data as a downloadable JSON
 * file — a safety net now that a meaningful amount of data (including AI
 * contract reviews) lives only in this app. Re-selects the same
 * personal-finance-only field set mirrorIntoSplitStores() already uses
 * (finance-store.ts) — deliberately excludes the trading-only collections,
 * which stay out of scope for this export.
 */
import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { isAuthenticated } from '../../server/auth-middleware'
import { getUnifiedTransactions, readFinanceStore, type FinanceDatabase } from '../../server/finance-store'

const exportColumns = ['date', 'kind', 'counterparty', 'category', 'subcategory', 'account', 'to_account', 'currency', 'amount', 'amount_lkr', 'status', 'tags', 'notes', 'source'] as const
function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function transactionsCsv(db: FinanceDatabase): string {
  const names = new Map(db.finance_accounts.map((account) => [account.id, account.name]))
  const rows = getUnifiedTransactions(db).map((row) => [
    row.date, row.kind, row.counterparty, row.category, row.subcategory,
    row.accountId ? names.get(row.accountId) ?? row.accountId : '',
    row.kind === 'transfer' ? names.get((db.transfers.find((item) => item.id === row.id)?.toAccountId as string) ?? '') ?? '' : '',
    row.currency, row.amount, row.convertedLkrAmount, row.status, row.tags, row.notes, row.source,
  ].map(csvCell).join(','))
  return [exportColumns.join(','), ...rows].join('\r\n') + '\r\n'
}

function htmlCell(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] ?? char))
}

export function reportHtml(db: FinanceDatabase): string {
  const rows = getUnifiedTransactions(db).map((row) => `<tr><td>${htmlCell(row.date)}</td><td>${htmlCell(row.kind)}</td><td>${htmlCell(row.counterparty)}</td><td>${htmlCell(row.category)}</td><td>${htmlCell(row.currency)} ${htmlCell(row.amount.toLocaleString('en-US'))}</td></tr>`).join('')
  const income = db.income_records.reduce((sum, row) => sum + row.convertedLkrAmount, 0)
  const expenses = db.expense_records.reduce((sum, row) => sum + row.convertedLkrAmount, 0)
  return `<!doctype html><html><head><meta charset="utf-8"><title>Personal finance summary</title></head><body><button onclick="print()">Print → Save as PDF</button><h1>Personal finance summary</h1><p>Net worth: LKR ${(income - expenses).toLocaleString('en-US')}</p><table><tbody>${rows}</tbody></table></body></html>`
}

export const Route = createFileRoute('/api/finance-export')({
  server: {
    handlers: {
      GET: ({ request }) => {
        if (!isAuthenticated(request)) {
          return json({ ok: false, error: 'Unauthorized' }, { status: 401 })
        }
        const db = readFinanceStore()
        const exportData = {
          schemaVersion: db.schemaVersion,
          exportedAt: new Date().toISOString(),
          finance_accounts: db.finance_accounts,
          income_records: db.income_records,
          expense_records: db.expense_records,
          budget_categories: db.budget_categories,
          savings_goals: db.savings_goals,
          tax_records: db.tax_records,
          income_sources: db.income_sources,
          stock_holdings: db.stock_holdings,
          fixed_deposits: db.fixed_deposits,
          pending_ingestions: db.pending_ingestions,
        }
        const filename = `personal-finance-export-${new Date().toISOString().slice(0, 10)}.json`
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
