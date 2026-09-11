import { useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { StatCard } from '../finance/components/stat-card'
import { BaseCurrencySelect } from './components/base-currency-select'
import { GmailConnectionCard } from './components/gmail-connection-card'
import { KnownSendersCard } from './components/known-senders-card'
import { CsvImportPanel } from './components/csv-import-panel'
import { BudgetPanel } from './components/budget-panel'
import { PendingIngestionPanel } from './components/pending-ingestion-panel'
import { FinanceAlertsCard } from './components/finance-alerts-card'
import { FinanceAnalystCard } from './components/finance-analyst-card'
import { FinanceTrendsCard } from './components/finance-trends-card'
import { NetWorthHistoryCard } from './components/net-worth-history-card'
import { SavingsGoalsProgress } from './components/savings-goals-progress'
import { SinkingFundsPanel } from './components/sinking-funds-panel'
import { GoalsTargetsCard } from './components/goals-targets-card'
import { UpcomingMoney } from './components/upcoming-money'
import { RecurringBillsInsight } from './components/recurring-bills-insight'
import { DataHealthCard } from './components/data-health-card'
import { AssistantMemoryCard } from './components/assistant-memory-card'
import { IncomeSourcesPanel } from './components/income-sources-panel'
import { StockHoldingsPanel } from './components/stock-holdings-panel'
import { FixedDepositsPanel } from './components/fixed-deposits-panel'
import { LoansPanel } from './components/loans-panel'
import { BeneficiariesPanel } from './components/beneficiaries-panel'
import { PropertiesPanel } from './components/properties-panel'
import { AccountsPanel } from './components/accounts-panel'
import { TransactionsPanel } from './components/transactions-panel'
import { ScheduledTransactionsPanel } from './components/scheduled-transactions-panel'
import { SavingsGoalsPanel } from './components/savings-goals-panel'
import { TaxRecordsPanel } from './components/tax-records-panel'
import { CategoriesPanel } from './components/categories-panel'
import { MerchantsPanel } from './components/merchants-panel'
import { TagsPanel } from './components/tags-panel'
import { formatLkr, formatMoney, formatPct } from './utils'
import { buttonClass } from './shared-styles'
import {
  usePendingIngestionCount,
  usePersonalFinance,
  useSetPersonalFinancePayload,
} from './hooks/use-personal-finance'
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
  const [tab, setTab] = useState<Tab>('overview')
  const financeQuery = usePersonalFinance()
  const setPayload = useSetPersonalFinancePayload()
  const pendingIngestionCount = usePendingIngestionCount()

  // isPending (not isLoading) — true only while there is no cached payload at
  // all, i.e. the genuine first load. A background refetch (staleTime expiry,
  // window-focus) keeps isPending false, so it never blanks the dashboard.
  if (financeQuery.isPending) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-muted)]">
        Loading Personal Finance section…
      </main>
    )
  }

  // Hard-fail only when we have never loaded a payload. If a background
  // refetch (window-focus / staleTime) fails but we still hold the last good
  // payload, keep rendering it rather than blanking the whole dashboard on a
  // transient blip.
  if (financeQuery.isError && financeQuery.data === undefined) {
    return (
      <main className="min-h-dvh bg-[var(--theme-bg)] p-6 text-[var(--theme-danger)]">
        <h1 className="text-2xl font-semibold">Personal finance unavailable</h1>
        <p className="mt-2 text-sm">
          {financeQuery.error instanceof Error
            ? financeQuery.error.message
            : 'Finance API failed'}
        </p>
      </main>
    )
  }

  const payload = financeQuery.data
  const { summary } = payload
  // PF-201: `summary.*Lkr` and `payload.budgetVsActual` are expressed in the
  // configured reporting currency (default 'LKR'). Per-entity amounts (accounts,
  // holdings, currency exposure) keep their own currency and are not routed here.
  const base = summary.baseCurrency
  const fmt = (value: number) => formatLkr(value, base)

  const netWorthBreakdown = [
    {
      name: 'Cash',
      value: Math.max(0, summary.cashBalanceBase),
      fill: 'var(--theme-accent)',
    },
    {
      name: 'Stocks',
      value: Math.max(0, summary.stockHoldingsValueBase),
      fill: 'var(--theme-accent-secondary)',
    },
    {
      name: 'Fixed deposits',
      value: Math.max(0, summary.fixedDepositsValueBase),
      fill: 'var(--theme-success)',
    },
    {
      name: 'Debt',
      value: Math.max(0, summary.debtBase),
      fill: 'var(--theme-danger)',
    },
  ].filter((entry) => entry.value > 0)

  const overBudgetCount = payload.budgetVsActual.filter(
    (b) => b.overBudget,
  ).length
  const exposure = payload.currencyExposure

  return (
    <main className="min-h-dvh overflow-y-auto bg-[var(--theme-bg)] px-4 py-5 text-[var(--theme-text)] md:px-8 md:py-8">
      <section className="rounded-[2rem] border border-[var(--theme-border)] bg-gradient-to-br from-[var(--theme-panel)] via-[var(--theme-panel)] to-emerald-950/20 p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color-mix(in_srgb,var(--theme-success)_80%,transparent)]">
              Personal finance
            </p>
            <h1 className="mt-2 text-3xl font-semibold md:text-4xl">
              Your money at a glance
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/finance-export?format=csv"
              download
              className={buttonClass}
            >
              Transactions (CSV)
            </a>
            <a
              href="/api/finance-export?format=report"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass}
            >
              Printable summary
            </a>
            <a href="/api/finance-export" download className={buttonClass}>
              All data (JSON)
            </a>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--theme-muted)]">
          Track your accounts, spending, budgets, savings goals, investments, and
          tax records — all in one place.
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-[var(--theme-muted)]">
          <span>
            Updated{' '}
            {new Date(payload.checkedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <button
            type="button"
            onClick={() => void financeQuery.refetch()}
            disabled={financeQuery.isFetching}
            className="rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_12%,transparent)] px-2 py-0.5 font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_20%,transparent)] disabled:opacity-50"
          >
            {financeQuery.isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
        </p>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Net worth" value={fmt(summary.netWorthBase)} />
        <StatCard
          label="Cash balance"
          value={fmt(summary.cashBalanceBase)}
        />
        <StatCard
          label="Net savings"
          value={fmt(summary.netSavingsBase)}
          tone={summary.netSavingsBase >= 0 ? 'good' : 'danger'}
        />
        <StatCard
          label="Savings rate"
          value={formatPct(summary.savingsRate)}
          tone={summary.savingsRate >= 20 ? 'good' : 'warn'}
        />
        <StatCard
          label="Total income"
          value={fmt(summary.totalIncomeBase)}
          tone="good"
        />
        <StatCard
          label="Total expenses"
          value={fmt(summary.totalExpensesBase)}
          tone={
            summary.totalExpensesBase > summary.totalIncomeBase &&
            summary.totalIncomeBase > 0
              ? 'danger'
              : 'neutral'
          }
        />
        <StatCard
          label="Stock holdings"
          value={fmt(summary.stockHoldingsValueBase)}
        />
        <StatCard
          label="Unrealized P/L"
          value={`${summary.unrealizedStockPnlBase >= 0 ? '+' : ''}${fmt(summary.unrealizedStockPnlBase)} (${summary.unrealizedStockPnlBase >= 0 ? '+' : ''}${formatPct(summary.unrealizedStockPnlPct)})`}
          tone={summary.unrealizedStockPnlBase >= 0 ? 'good' : 'danger'}
        />
        <StatCard
          label="Fixed deposits"
          value={fmt(summary.fixedDepositsValueBase)}
        />
      </section>

      {netWorthBreakdown.length > 0 && (
        <section className="mt-4 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
          <p className="text-xs font-medium text-[var(--theme-muted)]">
            Assets vs. liabilities
          </p>
          <div className="mt-1 h-[90px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={netWorthBreakdown}
                layout="vertical"
                margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="2 4"
                  stroke="var(--theme-border)"
                  opacity={0.4}
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  tick={{ fontSize: 10, fill: 'var(--theme-muted)' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `${Math.round(v / 1000)}k` : String(v)
                  }
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
                  contentStyle={{
                    background: 'var(--theme-panel)',
                    border: '1px solid var(--theme-border)',
                    borderRadius: 8,
                    fontSize: 11,
                  }}
                  formatter={(value: number) => fmt(value)}
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

      <NetWorthHistoryCard payload={payload} />

      {exposure.length > 0 && (
        <section className="mt-4 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
          <h2 className="text-sm font-semibold text-[var(--theme-text)]">
            Money held in other currencies
          </h2>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            You hold value across {exposure.length}{' '}
            {exposure.length === 1 ? 'currency' : 'currencies'} outside{' '}
            {base}. These aren&apos;t converted into your reporting currency —
            each is shown as-is, from active jobs, investments, and fixed
            deposits.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {exposure.map(({ currency, amount, breakdown }) => (
              <div
                key={currency}
                className="rounded-2xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-3"
              >
                <p className="text-sm font-semibold text-[var(--theme-text)]">
                  {formatMoney(amount, currency)}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--theme-muted)]">
                  {breakdown
                    .map((b) => `${b.label} · ${formatMoney(b.amount, currency)}`)
                    .join('  ·  ')}
                </p>
              </div>
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
                : 'text-[var(--theme-muted)] hover:bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] hover:text-[var(--theme-text)]'
            }`}
          >
            {t.label}
            {t.id === 'ingestion' && pendingIngestionCount > 0 && (
              <span className="ml-1.5 rounded-full bg-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--theme-warning)]">
                {pendingIngestionCount}
              </span>
            )}
            {t.id === 'records' && overBudgetCount > 0 && (
              <span className="ml-1.5 rounded-full bg-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--theme-danger)]">
                {overBudgetCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <>
          {/* Information hierarchy (docs/personal-finance-ux-review.md U1–U3):
              money first (alerts → AI Q&A → trends), then the merged
              "Goals & targets" widget + the savings/sinking lists, then
              "Coming up", then a collapsed drawer holding the reporting-
              currency picker and the storage / assistant-memory diagnostics
              — settings and health, not the daily view. The missing-rate
              warning still shows up top via FinanceAlertsCard. */}
          <FinanceAlertsCard payload={payload} />
          <FinanceAnalystCard payload={payload} onPayload={setPayload} />
          <FinanceTrendsCard payload={payload} />

          <GoalsTargetsCard payload={payload} onPayload={setPayload} />

          <section className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              Savings &amp; sinking funds
            </h2>
            <div className="mt-1 grid items-start gap-4 lg:grid-cols-2 [&>*]:mt-0">
              <SavingsGoalsProgress payload={payload} onPayload={setPayload} />
              <SinkingFundsPanel payload={payload} onPayload={setPayload} />
            </div>
          </section>

          <section className="mt-6">
            <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              Coming up
            </h2>
            <div className="mt-1 grid items-start gap-4 lg:grid-cols-2 [&>*]:mt-0">
              <UpcomingMoney payload={payload} onPayload={setPayload} />
              <RecurringBillsInsight payload={payload} onPayload={setPayload} />
            </div>
          </section>

          <details className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/50">
            <summary className="cursor-pointer list-none px-5 py-3 text-sm font-medium text-[var(--theme-muted)] hover:text-[var(--theme-text)]">
              Settings, assistant memory &amp; data health
            </summary>
            <div className="px-2 pb-2 [&>*]:mt-3">
              <BaseCurrencySelect payload={payload} onPayload={setPayload} />
              <GmailConnectionCard />
              <KnownSendersCard />
              <AssistantMemoryCard />
              <DataHealthCard payload={payload} />
            </div>
          </details>
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
          <LoansPanel payload={payload} onPayload={setPayload} />
          <PropertiesPanel payload={payload} onPayload={setPayload} />
          <BeneficiariesPanel payload={payload} onPayload={setPayload} />
        </>
      )}

      {tab === 'records' && (
        <section className="mt-6 grid gap-4">
          <AccountsPanel payload={payload} onPayload={setPayload} />
          <TransactionsPanel payload={payload} onPayload={setPayload} />
          <ScheduledTransactionsPanel payload={payload} onPayload={setPayload} />
          <CategoriesPanel payload={payload} onPayload={setPayload} />
          <MerchantsPanel payload={payload} onPayload={setPayload} />
          <TagsPanel payload={payload} onPayload={setPayload} />
          <p className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-3 text-xs text-[var(--theme-muted)]">
            Budget categories are managed on the <strong>Income</strong> tab
            (Budget vs. actual spending) — add, edit and delete them there.
          </p>
          <SavingsGoalsPanel payload={payload} onPayload={setPayload} />
          <TaxRecordsPanel payload={payload} onPayload={setPayload} />
        </section>
      )}

      {tab === 'ingestion' && (
        <>
          <PendingIngestionPanel payload={payload} onConfirmed={setPayload} />
          <div className="mt-4">
            <CsvImportPanel onPayload={setPayload} />
          </div>
        </>
      )}
    </main>
  )
}
