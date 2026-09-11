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
import { DataTable } from '../finance/components/data-table'
import { BudgetPanel } from './components/budget-panel'
import { ForecastingPanel } from './components/forecasting-panel'
import { PendingIngestionPanel } from './components/pending-ingestion-panel'
import { DocumentVaultPanel } from './components/document-vault-panel'
import { FinanceAlertsCard } from './components/finance-alerts-card'
import { FinancialRulesPanel } from './components/financial-rules-panel'
import { FinancialHealthCard } from './components/financial-health-card'
import { FinancialInsightsCard } from './components/financial-insights-card'
import { FinanceAnalystCard } from './components/finance-analyst-card'
import { FinanceManagerPanel } from './components/finance-manager-panel'
import { FinanceTrendsCard } from './components/finance-trends-card'
import { SavingsGoalsProgress } from './components/savings-goals-progress'
import { SinkingFundsPanel } from './components/sinking-funds-panel'
import { UpcomingMoney } from './components/upcoming-money'
import { RecurringBillsInsight } from './components/recurring-bills-insight'
import { DataHealthCard } from './components/data-health-card'
import { ExchangeRatesPanel } from './components/exchange-rates-panel'
import { BaseCurrencyPanel } from './components/base-currency-panel'
import { SafeToSpendCard } from './components/safe-to-spend-card'
import { TaxDocumentsPanel, TaxReviewQueue } from './components/tax-review-queue'
import { EmergencyFundCard } from './components/emergency-fund-card'
import { SavingsRateTargetCard } from './components/savings-rate-target-card'
import { WealthGoalCard } from './components/wealth-goal-card'
import { NetWorthSnapshotsPanel } from './components/net-worth-snapshots-panel'
import { IncomeSourcesPanel } from './components/income-sources-panel'
import { IncomeHistoryCard } from './components/income-history-card'
import { StockHoldingsPanel } from './components/stock-holdings-panel'
import { FixedDepositsPanel } from './components/fixed-deposits-panel'
import { InvestmentJournalPanel } from './components/investment-journal-panel'
import { LoansPanel } from './components/loans-panel'
import { BeneficiariesPanel } from './components/beneficiaries-panel'
import { PropertiesPanel } from './components/properties-panel'
import { InsurancePoliciesPanel } from './components/insurance-policies-panel'
import { AccountsPanel } from './components/accounts-panel'
import { TransactionsPanel } from './components/transactions-panel'
import { ReconciliationIssuesPanel } from './components/reconciliation-issues-panel'
import { CategoriesPanel } from './components/categories-panel'
import { MerchantsPanel } from './components/merchants-panel'
import { TagsPanel } from './components/tags-panel'
import { formatMoney, formatPct } from './utils'
import { currencyExposure } from './currency-exposure'
import { optionalNumberField as numberField } from './field-helpers'
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
            : 'Finance data unavailable'}
        </p>
      </main>
    )
  }

  const payload = financeQuery.data
  const { summary } = payload
  const baseCurrency = summary.baseCurrency ?? payload.baseCurrency ?? 'LKR'
  const baseSummary = summary.baseSummary ?? {
    netWorth: summary.netWorthLkr,
    liquidNetWorth: summary.liquidNetWorthLkr,
    lockedWealth: summary.lockedWealthLkr,
    cashBalance: summary.cashBalanceLkr,
    netSavings: summary.netSavingsLkr,
    savingsRate: summary.savingsRate,
    totalIncome: summary.totalIncomeLkr,
    totalExpenses: summary.totalExpensesLkr,
    stockHoldingsValue: summary.stockHoldingsValueLkr,
    unrealizedStockPnl: summary.unrealizedStockPnlLkr,
    unrealizedStockPnlPct: summary.unrealizedStockPnlPct,
    fixedDepositsValue: summary.fixedDepositsValueLkr,
    debt: summary.debtLkr,
  }
  const formatBase = (value: number) => formatMoney(value, baseCurrency)

  const netWorthBreakdown = [
    {
      name: 'Cash',
      value: Math.max(0, baseSummary.cashBalance),
      fill: 'var(--theme-accent)',
    },
    {
      name: 'Stocks',
      value: Math.max(0, baseSummary.stockHoldingsValue),
      fill: 'var(--theme-accent-secondary)',
    },
    {
      name: 'Fixed deposits',
      value: Math.max(0, baseSummary.fixedDepositsValue),
      fill: 'var(--theme-success)',
    },
    {
      name: 'Debt',
      value: Math.max(0, baseSummary.debt),
      fill: 'var(--theme-danger)',
    },
  ].filter((entry) => entry.value > 0)

  const overBudgetCount = payload.budgetVsActual.filter(
    (b) => b.overBudget,
  ).length
  const exposure = currencyExposure(payload)

  return (
    <main className="min-h-dvh overflow-y-auto bg-[var(--theme-bg)] px-4 py-5 text-[var(--theme-text)] md:px-8 md:py-8">
      <section className="rounded-[2rem] border border-[var(--theme-border)] bg-gradient-to-br from-[var(--theme-panel)] via-[var(--theme-panel)] to-emerald-950/20 p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[color-mix(in_srgb,var(--theme-success)_80%,transparent)]">
              DollarWise-style personal finance
            </p>
            <h1 className="mt-2 text-3xl font-semibold md:text-4xl">
              Money clarity, without trading controls
            </h1>
          </div>
          <a href="/api/finance-export" download className={buttonClass}>
            Export data (JSON)
          </a>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--theme-muted)]">
          Track accounts, spending, budgets, savings goals, investments, and tax
          records — separate from the automated trading workspace.
        </p>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={`Net worth (${baseCurrency})`} value={formatBase(baseSummary.netWorth)} />
        <StatCard
          label="Liquid net worth"
          value={formatBase(baseSummary.liquidNetWorth)}
          tone={baseSummary.liquidNetWorth >= 0 ? 'good' : 'danger'}
        />
        <StatCard
          label="Locked wealth"
          value={formatBase(baseSummary.lockedWealth)}
        />
        <StatCard
          label="Cash balance"
          value={formatBase(baseSummary.cashBalance)}
        />
        <StatCard
          label="Net savings"
          value={formatBase(baseSummary.netSavings)}
          tone={baseSummary.netSavings >= 0 ? 'good' : 'danger'}
        />
        <StatCard
          label="Savings rate"
          value={formatPct(baseSummary.savingsRate)}
          tone={baseSummary.savingsRate >= 20 ? 'good' : 'warn'}
        />
        <StatCard
          label="Total income"
          value={formatBase(baseSummary.totalIncome)}
          tone="good"
        />
        <StatCard
          label="Total expenses"
          value={formatBase(baseSummary.totalExpenses)}
          tone={
            baseSummary.totalExpenses > baseSummary.totalIncome &&
            baseSummary.totalIncome > 0
              ? 'danger'
              : 'neutral'
          }
        />
        <StatCard
          label="Stock holdings"
          value={formatBase(baseSummary.stockHoldingsValue)}
        />
        <StatCard
          label="Unrealized P/L"
          value={`${baseSummary.unrealizedStockPnl >= 0 ? '+' : ''}${formatBase(baseSummary.unrealizedStockPnl)} (${baseSummary.unrealizedStockPnl >= 0 ? '+' : ''}${formatPct(baseSummary.unrealizedStockPnlPct)})`}
          tone={baseSummary.unrealizedStockPnl >= 0 ? 'good' : 'danger'}
        />
        <StatCard
          label="Fixed deposits"
          value={formatBase(baseSummary.fixedDepositsValue)}
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
                  formatter={(value: number) => formatBase(value)}
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
        <section className="mt-4 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
          <p className="text-xs font-medium text-[var(--theme-muted)]">
            Currency exposure (active jobs, holdings, and fixed deposits)
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            {exposure.map(({ currency, amount, baseAmount }) => (
              <span
                key={currency}
                className="text-sm font-medium text-[var(--theme-text)]"
              >
                {formatMoney(amount, currency)}
                {currency !== baseCurrency && (
                  <span className="ml-2 text-xs text-[var(--theme-muted)]">
                    {baseAmount !== undefined
                      ? <>≈ {formatMoney(baseAmount, baseCurrency)}</>
                      : '· rate unavailable'}
                  </span>
                )}
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
          <FinanceAlertsCard payload={payload} onPayload={setPayload} />
          <BaseCurrencyPanel payload={payload} onPayload={setPayload} />
          <FinancialHealthCard payload={payload} />
          <FinancialInsightsCard payload={payload} onPayload={setPayload} />
          <NetWorthSnapshotsPanel payload={payload} onPayload={setPayload} />
          <FinancialRulesPanel payload={payload} onPayload={setPayload} />
          <SafeToSpendCard payload={payload} onPayload={setPayload} />
          <FinanceAnalystCard payload={payload} onPayload={setPayload} />
          <FinanceManagerPanel payload={payload} onPayload={setPayload} />
          <ForecastingPanel
            incomeRecords={payload.data.income_records}
            expenseRecords={payload.data.expense_records}
            incomeSources={payload.data.income_sources}
          />
          <FinanceTrendsCard payload={payload} />
          <SavingsGoalsProgress payload={payload} onPayload={setPayload} />
          <SinkingFundsPanel payload={payload} onPayload={setPayload} />
          <EmergencyFundCard payload={payload} onPayload={setPayload} />
          <SavingsRateTargetCard payload={payload} onPayload={setPayload} />
          <WealthGoalCard payload={payload} onPayload={setPayload} />
          <UpcomingMoney payload={payload} />
          <RecurringBillsInsight payload={payload} />
          <DataHealthCard payload={payload} />
        </>
      )}

      {tab === 'income' && (
        <>
          <IncomeSourcesPanel payload={payload} onPayload={setPayload} />
          <IncomeHistoryCard payload={payload} onPayload={setPayload} />
          <BudgetPanel payload={payload} onPayload={setPayload} />
        </>
      )}

      {tab === 'investments' && (
        <>
          <StockHoldingsPanel payload={payload} onPayload={setPayload} />
          <InvestmentJournalPanel payload={payload} onPayload={setPayload} />
          <FixedDepositsPanel payload={payload} onPayload={setPayload} />
          <LoansPanel payload={payload} onPayload={setPayload} />
          <PropertiesPanel payload={payload} onPayload={setPayload} />
          <InsurancePoliciesPanel payload={payload} onPayload={setPayload} />
          <BeneficiariesPanel payload={payload} onPayload={setPayload} />
        </>
      )}

      {tab === 'records' && (
        <section className="mt-6 grid gap-4">
          <AccountsPanel payload={payload} onPayload={setPayload} />
          <ExchangeRatesPanel payload={payload} onPayload={setPayload} />
          <ReconciliationIssuesPanel payload={payload} onPayload={setPayload} />
          <TransactionsPanel payload={payload} onPayload={setPayload} />
          <CategoriesPanel payload={payload} onPayload={setPayload} />
          <MerchantsPanel payload={payload} onPayload={setPayload} />
          <TagsPanel payload={payload} onPayload={setPayload} />
          <TaxReviewQueue payload={payload} onPayload={setPayload} />
          <TaxDocumentsPanel payload={payload} />
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
            columns={[
              'name',
              'targetAmount',
              'currentAmount',
              'currency',
              'targetDate',
              'status',
              'goalKind',
              'monthlyContribution',
              'priority',
            ]}
            kind="goal"
            onChanged={(p) => setPayload(p as PersonalFinancePayload)}
            searchable
          />
          <DataTable
            title="Tax records"
            rows={payload.data.tax_records}
            columns={[
              'taxYear',
              'incomeType',
              'currency',
              'convertedLkrAmount',
              'exchangeRateSource',
              'taxPaid',
              'taxDue',
              'deductionCategory',
              'supportingDocument',
              'requiresConfirmation',
            ]}
            kind="tax"
            onChanged={(p) => setPayload(p as PersonalFinancePayload)}
            searchable
          />
          <p className="rounded-2xl border border-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] p-4 text-sm text-[var(--theme-warning)]">
            Tax figures are estimates; confirm them against official sources
            before filing.
          </p>
        </section>
      )}

      {tab === 'ingestion' && (
        <>
          <DocumentVaultPanel />
          <PendingIngestionPanel payload={payload} onConfirmed={setPayload} />
        </>
      )}
    </main>
  )
}
