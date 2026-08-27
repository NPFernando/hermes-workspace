import { useEffect, useState } from 'react'
import { StatCard } from '../finance/components/stat-card'
import { DataTable } from '../finance/components/data-table'
import { BudgetPanel } from './components/budget-panel'
import { PendingIngestionPanel } from './components/pending-ingestion-panel'
import { FinanceTrendsCard } from './components/finance-trends-card'
import { SavingsGoalsProgress } from './components/savings-goals-progress'
import { RecurringBillsInsight } from './components/recurring-bills-insight'
import { IncomeSourcesPanel } from './components/income-sources-panel'
import { StockHoldingsPanel } from './components/stock-holdings-panel'
import { FixedDepositsPanel } from './components/fixed-deposits-panel'
import { formatLkr, formatPct } from './utils'
import type { PersonalFinancePayload } from './types'

type Tab = 'overview' | 'income' | 'investments' | 'records' | 'ingestion'

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'income', label: 'Income & Jobs' },
  { id: 'investments', label: 'Investments' },
  { id: 'records', label: 'Accounts & Records' },
  { id: 'ingestion', label: 'Ingestion' },
]

export function PersonalFinanceScreen() {
  const [payload, setPayload] = useState<PersonalFinancePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('overview')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const response = await fetch('/api/finance', { cache: 'no-store' })
        if (!response.ok)
          throw new Error(`Finance API returned HTTP ${response.status}`)
        const data = (await response.json()) as PersonalFinancePayload
        if (!cancelled) {
          setPayload(data)
          setError(null)
        }
      } catch (nextError) {
        if (!cancelled)
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'Finance API failed',
          )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-muted)]">
        Loading Personal Finance section…
      </main>
    )
  }

  if (error || !payload) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-red-200">
        <h1 className="text-2xl font-semibold">Personal finance unavailable</h1>
        <p className="mt-2 text-sm">{error ?? 'No payload returned.'}</p>
      </main>
    )
  }

  const { summary } = payload

  return (
    <main className="min-h-dvh overflow-y-auto bg-[var(--theme-bg)] px-4 py-5 text-[var(--theme-text)] md:px-8 md:py-8">
      <section className="rounded-[2rem] border border-[var(--theme-border)] bg-gradient-to-br from-[var(--theme-panel)] via-[var(--theme-panel)] to-emerald-950/20 p-6 shadow-xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200/80">
          DollarWise-style personal finance
        </p>
        <h1 className="mt-2 text-3xl font-semibold md:text-4xl">
          Money clarity, without trading controls
        </h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--theme-muted)]">
          Track accounts, spending, budgets, savings goals, investments, and tax records —
          separate from the automated trading workspace.
        </p>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net worth" value={formatLkr(summary.netWorthLkr)} />
        <StatCard label="Cash balance" value={formatLkr(summary.cashBalanceLkr)} />
        <StatCard label="Net savings" value={formatLkr(summary.netSavingsLkr)} tone={summary.netSavingsLkr >= 0 ? 'good' : 'danger'} />
        <StatCard label="Savings rate" value={formatPct(summary.savingsRate)} tone={summary.savingsRate >= 20 ? 'good' : 'warn'} />
        <StatCard label="Total income" value={formatLkr(summary.totalIncomeLkr)} tone="good" />
        <StatCard label="Total expenses" value={formatLkr(summary.totalExpensesLkr)} tone={summary.totalExpensesLkr > summary.totalIncomeLkr && summary.totalIncomeLkr > 0 ? 'danger' : 'neutral'} />
        <StatCard label="Stock holdings" value={formatLkr(summary.stockHoldingsValueLkr)} />
        <StatCard label="Fixed deposits" value={formatLkr(summary.fixedDepositsValueLkr)} />
      </section>

      <nav className="mt-6 flex flex-wrap gap-2 border-b border-[var(--theme-border)] pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? 'bg-[var(--theme-accent-soft)] text-[var(--theme-accent)]'
                : 'text-[var(--theme-muted)] hover:bg-black/10 hover:text-[var(--theme-text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <FinanceTrendsCard payload={payload} />
          <SavingsGoalsProgress payload={payload} />
          <RecurringBillsInsight payload={payload} />
        </>
      )}

      {tab === 'income' && (
        <>
          <IncomeSourcesPanel payload={payload} onPayload={setPayload} />
          <BudgetPanel payload={payload} onPayload={setPayload} />
          <section className="mt-6">
            <DataTable
              title="Income records"
              rows={payload.data.income_records}
              columns={['dateReceived', 'sourceName', 'incomeType', 'originalCurrency', 'originalAmount', 'convertedLkrAmount', 'taxable']}
              kind="income"
              onChanged={(p) => setPayload(p as PersonalFinancePayload)}
              searchable
            />
          </section>
        </>
      )}

      {tab === 'investments' && (
        <>
          <StockHoldingsPanel payload={payload} onPayload={setPayload} />
          <FixedDepositsPanel payload={payload} onPayload={setPayload} />
        </>
      )}

      {tab === 'records' && (
        <section className="mt-6 grid gap-4">
          <DataTable
            title="Accounts"
            rows={payload.data.finance_accounts}
            columns={['name', 'type', 'currency', 'balance', 'platform']}
            kind="account"
            onChanged={(p) => setPayload(p as PersonalFinancePayload)}
            searchable
          />
          <DataTable
            title="Expense records"
            rows={payload.data.expense_records}
            columns={['date', 'vendor', 'category', 'currency', 'amount', 'convertedLkrAmount', 'recurring']}
            kind="expense"
            onChanged={(p) => setPayload(p as PersonalFinancePayload)}
            searchable
          />
          <DataTable
            title="Budget categories"
            rows={payload.data.budget_categories}
            columns={['month', 'category', 'currency', 'budgetAmount']}
            kind="budget_category"
            onChanged={(p) => setPayload(p as PersonalFinancePayload)}
            searchable
          />
          <DataTable
            title="Savings goals"
            rows={payload.data.savings_goals}
            columns={['name', 'targetAmount', 'currentAmount', 'currency', 'targetDate', 'status']}
            kind="goal"
            onChanged={(p) => setPayload(p as PersonalFinancePayload)}
            searchable
          />
          <DataTable
            title="Tax records"
            rows={payload.data.tax_records}
            columns={['taxYear', 'incomeType', 'convertedLkrAmount', 'taxPaid', 'taxDue', 'requiresConfirmation']}
            kind="tax"
            onChanged={(p) => setPayload(p as PersonalFinancePayload)}
            searchable
          />
          <p className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
            Tax figures are estimates; confirm them against official sources before filing.
          </p>
        </section>
      )}

      {tab === 'ingestion' && <PendingIngestionPanel onConfirmed={setPayload} />}
    </main>
  )
}
