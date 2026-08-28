import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { StatCard } from '../finance/components/stat-card'
import { DataTable } from '../finance/components/data-table'
import { BudgetPanel } from './components/budget-panel'
import { PendingIngestionPanel } from './components/pending-ingestion-panel'
import { FinanceAlertsCard } from './components/finance-alerts-card'
import { FinanceTrendsCard } from './components/finance-trends-card'
import { SavingsGoalsProgress } from './components/savings-goals-progress'
import { UpcomingMoney } from './components/upcoming-money'
import { RecurringBillsInsight } from './components/recurring-bills-insight'
import { DataHealthCard } from './components/data-health-card'
import { IncomeSourcesPanel } from './components/income-sources-panel'
import { StockHoldingsPanel } from './components/stock-holdings-panel'
import { FixedDepositsPanel } from './components/fixed-deposits-panel'
import { AccountsPanel } from './components/accounts-panel'
import { TransactionsPanel } from './components/transactions-panel'
import { CategoriesPanel } from './components/categories-panel'
import { MerchantsPanel } from './components/merchants-panel'
import { TagsPanel } from './components/tags-panel'
import { formatLkr, formatMoney, formatPct } from './utils'
import type { PersonalFinancePayload } from './types'

type Tab = 'overview' | 'income' | 'investments' | 'records' | 'ingestion'

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function numberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Grouped by currency, not converted to one figure — this codebase has no
 * FX-conversion service (only a manually-entered per-record rate on one-off
 * income entries), so summing across currencies here would invent a
 * conversion the rest of the app deliberately doesn't do either.
 */
function currencyExposure(payload: PersonalFinancePayload): Array<{ currency: string; amount: number }> {
  const totals = new Map<string, number>()
  const add = (currency: string, amount: number) => totals.set(currency, (totals.get(currency) ?? 0) + amount)

  for (const job of payload.data.income_sources) {
    if (stringField(job, 'status') !== 'active') continue
    const amount = numberField(job, 'monthlyIncomeAmount')
    if (amount !== undefined) add(stringField(job, 'currency') || 'LKR', amount)
  }
  for (const holding of payload.data.stock_holdings) {
    const qty = numberField(holding, 'quantity') ?? 0
    const price = numberField(holding, 'lastKnownPrice') ?? numberField(holding, 'buyPrice') ?? 0
    add(stringField(holding, 'currency') || 'LKR', qty * price)
  }
  for (const fd of payload.data.fixed_deposits) {
    if (stringField(fd, 'status') === 'withdrawn') continue
    const principal = numberField(fd, 'principal')
    if (principal !== undefined) add(stringField(fd, 'currency') || 'LKR', principal)
  }

  return Array.from(totals.entries())
    .filter(([, amount]) => amount > 0)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount)
}

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
  const [pendingIngestionCount, setPendingIngestionCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function loadPendingCount() {
      try {
        const res = await fetch('/api/finance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'list_pending_ingestions' }),
        })
        const data = (await res.json()) as { ok?: boolean; pendingIngestions?: Array<{ status: string }> }
        if (!cancelled && data.ok) {
          const count = (data.pendingIngestions ?? []).filter(
            (p) => p.status === 'awaiting_review' || p.status === 'awaiting_password',
          ).length
          setPendingIngestionCount(count)
        }
      } catch {
        /* transient */
      }
    }
    void loadPendingCount()
    const interval = setInterval(() => void loadPendingCount(), 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const response = await fetch('/api/finance?scope=personal_finance', { cache: 'no-store' })
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

  const netWorthBreakdown = [
    { name: 'Cash', value: Math.max(0, summary.cashBalanceLkr), fill: '#38bdf8' },
    { name: 'Stocks', value: Math.max(0, summary.stockHoldingsValueLkr), fill: '#38bdf8' },
    { name: 'Fixed deposits', value: Math.max(0, summary.fixedDepositsValueLkr), fill: '#38bdf8' },
    { name: 'Debt', value: Math.max(0, summary.debtLkr), fill: '#f87171' },
  ].filter((entry) => entry.value > 0)

  const overBudgetCount = payload.budgetVsActual.filter((b) => b.overBudget).length
  const exposure = currencyExposure(payload)

  return (
    <main className="min-h-dvh overflow-y-auto bg-[var(--theme-bg)] px-4 py-5 text-[var(--theme-text)] md:px-8 md:py-8">
      <section className="rounded-[2rem] border border-[var(--theme-border)] bg-gradient-to-br from-[var(--theme-panel)] via-[var(--theme-panel)] to-emerald-950/20 p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200/80">
              DollarWise-style personal finance
            </p>
            <h1 className="mt-2 text-3xl font-semibold md:text-4xl">
              Money clarity, without trading controls
            </h1>
          </div>
          <a
            href="/api/finance-export"
            download
            className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20"
          >
            Export data (JSON)
          </a>
        </div>
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
        <StatCard
          label="Unrealized P/L"
          value={`${summary.unrealizedStockPnlLkr >= 0 ? '+' : ''}${formatLkr(summary.unrealizedStockPnlLkr)} (${summary.unrealizedStockPnlLkr >= 0 ? '+' : ''}${formatPct(summary.unrealizedStockPnlPct)})`}
          tone={summary.unrealizedStockPnlLkr >= 0 ? 'good' : 'danger'}
        />
        <StatCard label="Fixed deposits" value={formatLkr(summary.fixedDepositsValueLkr)} />
      </section>

      {netWorthBreakdown.length > 0 && (
        <section className="mt-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-4">
          <p className="text-xs font-medium text-[var(--theme-muted)]">Assets vs. liabilities</p>
          <div className="mt-1 h-[90px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={netWorthBreakdown} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--theme-border)" opacity={0.4} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  width={80}
                />
                <Tooltip
                  contentStyle={{ background: 'var(--theme-panel)', border: '1px solid var(--theme-border)', borderRadius: 8, fontSize: 11 }}
                  formatter={(value: number) => formatLkr(value)}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {netWorthBreakdown.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {exposure.length > 0 && (
        <section className="mt-4 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-4">
          <p className="text-xs font-medium text-[var(--theme-muted)]">
            Currency exposure (active jobs, holdings, and fixed deposits — not converted)
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            {exposure.map(({ currency, amount }) => (
              <span key={currency} className="text-sm font-medium text-[var(--theme-text)]">
                {formatMoney(amount, currency)}
              </span>
            ))}
          </div>
        </section>
      )}

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
            {t.id === 'ingestion' && pendingIngestionCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-amber-100">
                {pendingIngestionCount}
              </span>
            )}
            {t.id === 'records' && overBudgetCount > 0 && (
              <span className="ml-1.5 rounded-full bg-red-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-red-100">
                {overBudgetCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          <FinanceAlertsCard payload={payload} />
          <FinanceTrendsCard payload={payload} />
          <SavingsGoalsProgress payload={payload} />
          <UpcomingMoney payload={payload} />
          <RecurringBillsInsight payload={payload} />
          <DataHealthCard payload={payload} />
        </>
      )}

      {tab === 'income' && (
        <>
          <IncomeSourcesPanel payload={payload} onPayload={setPayload} />
          <BudgetPanel payload={payload} onPayload={setPayload} />
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
          <AccountsPanel payload={payload} onPayload={setPayload} />
          <TransactionsPanel payload={payload} onPayload={setPayload} />
          <CategoriesPanel payload={payload} onPayload={setPayload} />
          <MerchantsPanel payload={payload} onPayload={setPayload} />
          <TagsPanel payload={payload} onPayload={setPayload} />
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
            columns={['taxYear', 'incomeType', 'currency', 'convertedLkrAmount', 'exchangeRateSource', 'taxPaid', 'taxDue', 'deductionCategory', 'supportingDocument', 'requiresConfirmation']}
            kind="tax"
            onChanged={(p) => setPayload(p as PersonalFinancePayload)}
            searchable
          />
          <p className="rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
            Tax figures are estimates; confirm them against official sources before filing.
          </p>
        </section>
      )}

      {tab === 'ingestion' && <PendingIngestionPanel payload={payload} onConfirmed={setPayload} />}
    </main>
  )
}
