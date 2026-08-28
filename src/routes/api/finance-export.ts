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
import { readFinanceStore } from '../../server/finance-store'

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
