import { useEffect, useState } from 'react'
import { useFinanceAction } from '../finance/hooks/use-finance-action'
import { StatCard } from '../finance/components/stat-card'
import { DataTable } from '../finance/components/data-table'

type PersonalFinancePayload = {
  ok: boolean
  summary: {
    netWorthLkr: number
    cashBalanceLkr: number
    netSavingsLkr: number
    savingsRate: number
    totalIncomeLkr: number
    totalExpensesLkr: number
    taxReserveLkr: number
    accountCount: number
  }
  budgetVsActual: Array<{
    category: string
    month: string
    currency: string
    budget: number
    actual: number
    variance: number
    percentUsed: number
    overBudget: boolean
  }>
  data: {
    finance_accounts: Array<Record<string, unknown>>
    income_records: Array<Record<string, unknown>>
    expense_records: Array<Record<string, unknown>>
    budget_categories: Array<Record<string, unknown>>
    savings_goals: Array<Record<string, unknown>>
    tax_records: Array<Record<string, unknown>>
  }
}

function formatLkr(value: number): string {
  return `LKR ${Math.round(value).toLocaleString('en-LK')}`
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`
}

function budgetTone(percentUsed: number): 'good' | 'warn' | 'danger' {
  if (percentUsed > 100) return 'danger'
  if (percentUsed >= 80) return 'warn'
  return 'good'
}

function BudgetPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const { run: post, busy, error: err, setError: setErr } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [budgetMonth, setBudgetMonth] = useState(currentMonth)
  const [budgetCategory, setBudgetCategory] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState('LKR')
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [expenseVendor, setExpenseVendor] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCurrency, setExpenseCurrency] = useState('LKR')

  async function submitBudget() {
    if (!budgetCategory.trim()) {
      setErr('Category is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'budget_category',
        payload: {
          month: budgetMonth,
          category: budgetCategory.trim(),
          currency: budgetCurrency,
          budgetAmount: Number(budgetAmount) || 0,
        },
      },
      'budget',
    )
    if (data) {
      setBudgetCategory('')
      setBudgetAmount('')
    }
  }

  async function submitExpense() {
    if (!expenseVendor.trim() || !expenseCategory.trim()) {
      setErr('Vendor and category are required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'expense',
        payload: {
          date: expenseDate,
          vendor: expenseVendor.trim(),
          category: expenseCategory.trim(),
          currency: expenseCurrency,
          amount: Number(expenseAmount) || 0,
        },
      },
      'expense',
    )
    if (data) {
      setExpenseVendor('')
      setExpenseCategory('')
      setExpenseAmount('')
    }
  }

  const inputClass =
    'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
  const buttonClass =
    'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Budget vs. actual spending</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Set a monthly budget per category, log expenses, and see how
            actual spending compares — updates instantly below. Enter budgets
            in LKR; actual spend is always compared in LKR-converted terms.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
          <h3 className="text-sm font-semibold">Add a budget</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="month"
              value={budgetMonth}
              onChange={(e) => setBudgetMonth(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Category (e.g. Groceries)"
              value={budgetCategory}
              onChange={(e) => setBudgetCategory(e.target.value)}
              className={inputClass}
            />
            <input
              type="number"
              placeholder="Budget amount"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              className={`${inputClass} w-32`}
            />
            <select
              value={budgetCurrency}
              onChange={(e) => setBudgetCurrency(e.target.value)}
              className={inputClass}
            >
              <option value="LKR">LKR</option>
              <option value="USD">USD</option>
              <option value="AUD">AUD</option>
            </select>
            <button
              type="button"
              disabled={busy === 'budget'}
              onClick={() => void submitBudget()}
              className={buttonClass}
            >
              {busy === 'budget' ? 'Saving...' : 'Add budget'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
          <h3 className="text-sm font-semibold">Log an expense</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Vendor"
              value={expenseVendor}
              onChange={(e) => setExpenseVendor(e.target.value)}
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Category"
              value={expenseCategory}
              onChange={(e) => setExpenseCategory(e.target.value)}
              className={inputClass}
            />
            <input
              type="number"
              placeholder="Amount"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              className={`${inputClass} w-28`}
            />
            <select
              value={expenseCurrency}
              onChange={(e) => setExpenseCurrency(e.target.value)}
              className={inputClass}
            >
              <option value="LKR">LKR</option>
              <option value="USD">USD</option>
              <option value="AUD">AUD</option>
            </select>
            <button
              type="button"
              disabled={busy === 'expense'}
              onClick={() => void submitExpense()}
              className={buttonClass}
            >
              {busy === 'expense' ? 'Saving...' : 'Log expense'}
            </button>
          </div>
        </div>
      </div>

      {err && <p className="mt-3 text-xs text-red-300">{err}</p>}

      <div className="mt-4">
        <h3 className="text-sm font-semibold">
          This month ({currentMonth})
        </h3>
        {payload.budgetVsActual.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--theme-muted)]">
            No budgets set for this month yet — add one above to see how
            actual spending compares.
          </p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {payload.budgetVsActual.map((row) => (
              <StatCard
                key={`${row.month}-${row.category}`}
                label={`${row.category} — ${Math.round(row.percentUsed)}% used`}
                value={`${formatLkr(row.actual)} / ${formatLkr(row.budget)}`}
                tone={budgetTone(row.percentUsed)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

export function PersonalFinanceScreen() {
  const [payload, setPayload] = useState<PersonalFinancePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
          Track accounts, spending, budgets, savings goals, and tax records —
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
        <StatCard label="Tax reserve" value={formatLkr(summary.taxReserveLkr)} />
        <StatCard label="Tracked accounts" value={String(summary.accountCount)} />
      </section>

      <BudgetPanel payload={payload} onPayload={setPayload} />

      <section className="mt-6 grid gap-4">
        <DataTable title="Accounts" rows={payload.data.finance_accounts} columns={['name', 'type', 'currency', 'balance', 'platform']} />
        <DataTable title="Income records" rows={payload.data.income_records} columns={['dateReceived', 'sourceName', 'incomeType', 'originalCurrency', 'originalAmount', 'convertedLkrAmount', 'taxable']} />
        <DataTable title="Expense records" rows={payload.data.expense_records} columns={['date', 'vendor', 'category', 'currency', 'amount', 'convertedLkrAmount', 'recurring']} />
        <DataTable title="Budget categories" rows={payload.data.budget_categories} columns={['month', 'category', 'currency', 'budgetAmount']} />
        <DataTable title="Savings goals" rows={payload.data.savings_goals} columns={['name', 'targetAmount', 'currentAmount', 'currency', 'targetDate', 'status']} />
        <DataTable title="Tax records" rows={payload.data.tax_records} columns={['taxYear', 'incomeType', 'convertedLkrAmount', 'taxPaid', 'taxDue', 'requiresConfirmation']} />
      </section>

      <p className="mt-6 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">
        Tax figures are estimates; confirm them against official sources before filing.
      </p>
    </main>
  )
}
