import { useState } from 'react'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { StatCard } from '../../finance/components/stat-card'
import { formatLkr, formatMoney } from '../utils'
import { numberField, stringField } from '../field-helpers'
import { buttonClass, inputClass } from '../shared-styles'
import type { PersonalFinancePayload } from '../types'

function budgetTone(row: {
  percentUsed: number
  approachingBudget: boolean
  overBudget: boolean
}): 'good' | 'warn' | 'danger' {
  if (row.overBudget || row.percentUsed > 100) return 'danger'
  if (row.approachingBudget) return 'warn'
  return 'good'
}

export type ProjectedSpendRow = {
  category: string
  budget: number
  actual: number
  projected: number
  variance: number
  percentUsed: number
}

export type CommittedSpendSummary = {
  totalLkr: number
  categories: Array<{ category: string; amountLkr: number }>
}

export type BudgetRolloverRow = {
  category: string
  budget: number
  rollover: number
  available: number
}

function previousMonth(month: string): string {
  const date = new Date(`${month}-01T12:00:00.000Z`)
  date.setUTCMonth(date.getUTCMonth() - 1)
  return date.toISOString().slice(0, 7)
}

/** PF-809: read-only carry-forward of unused prior-month LKR budget. */
export function buildBudgetRollover(
  month: string,
  currentRows: Array<{ category: string; currency: string; budget: number }>,
  budgetRecords: Array<Record<string, unknown>>,
  expenseRecords: Array<Record<string, unknown>>,
): Array<BudgetRolloverRow> {
  const prior = previousMonth(month)
  const priorBudget = new Map<string, number>()
  for (const row of budgetRecords) {
    if (stringField(row, 'month') !== prior || (stringField(row, 'currency') || 'LKR') !== 'LKR') continue
    const category = stringField(row, 'category') || 'Other'
    priorBudget.set(category, (priorBudget.get(category) ?? 0) + numberField(row, 'budgetAmount'))
  }
  const priorActual = new Map<string, number>()
  for (const expense of expenseRecords) {
    if (
      stringField(expense, 'date').slice(0, 7) !== prior ||
      (stringField(expense, 'currency') || 'LKR') !== 'LKR' ||
      expense.deletedAt ||
      stringField(expense, 'transactionType') === 'transfer'
    ) continue
    const category = stringField(expense, 'category') || 'Other'
    priorActual.set(category, (priorActual.get(category) ?? 0) + numberField(expense, 'convertedLkrAmount'))
  }
  return currentRows
    .filter((row) => row.currency === 'LKR')
    .map((row) => {
      const rollover = Math.max(0, (priorBudget.get(row.category) ?? 0) - (priorActual.get(row.category) ?? 0))
      return { category: row.category, budget: row.budget, rollover, available: row.budget + rollover }
    })
}

/** PF-805: only explicitly flagged recurring LKR records are counted. */
export function buildCommittedSpend(
  month: string,
  expenseRecords: Array<Record<string, unknown>>,
): CommittedSpendSummary {
  const totals = new Map<string, number>()
  for (const expense of expenseRecords) {
    if (
      stringField(expense, 'date').slice(0, 7) !== month ||
      expense.recurring !== true ||
      (stringField(expense, 'currency') || 'LKR') !== 'LKR' ||
      expense.deletedAt ||
      stringField(expense, 'transactionType') === 'transfer'
    )
      continue
    const category = stringField(expense, 'category') || 'Other'
    totals.set(
      category,
      (totals.get(category) ?? 0) + numberField(expense, 'convertedLkrAmount'),
    )
  }
  const categories = Array.from(totals.entries())
    .map(([category, amountLkr]) => ({ category, amountLkr }))
    .sort((a, b) => b.amountLkr - a.amountLkr)
  return {
    totalLkr: categories.reduce((sum, row) => sum + row.amountLkr, 0),
    categories,
  }
}

/** PF-807: run-rate projection plus explicitly future-dated recurring entries. */
export function buildProjectedSpend(
  month: string,
  budgetRows: Array<{ category: string; currency: string; budget: number; actual: number }>,
  expenseRecords: Array<Record<string, unknown>>,
  asOf = new Date(),
): Array<ProjectedSpendRow> {
  const year = Number(month.slice(0, 4))
  const monthIndex = Number(month.slice(5, 7)) - 1
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const asOfMonth = `${asOf.getFullYear()}-${String(asOf.getMonth() + 1).padStart(2, '0')}`
  const elapsedDays = asOfMonth === month ? Math.max(1, asOf.getDate()) : daysInMonth
  return budgetRows
    .filter((row) => row.currency === 'LKR')
    .map((row) => {
      const futureRecurring = expenseRecords
        .filter((expense) =>
          stringField(expense, 'date').slice(0, 7) === month &&
          stringField(expense, 'date') > (asOfMonth === month ? asOf.toISOString().slice(0, 10) : '') &&
          expense.recurring === true &&
          !expense.deletedAt &&
          stringField(expense, 'transactionType') !== 'transfer' &&
          (stringField(expense, 'category') || 'Other') === row.category,
        )
        .reduce((sum, expense) => sum + numberField(expense, 'convertedLkrAmount'), 0)
      const runRate = row.actual * (daysInMonth / elapsedDays)
      const projected = Math.max(row.actual, runRate, row.actual + futureRecurring)
      return {
        category: row.category,
        budget: row.budget,
        actual: row.actual,
        projected,
        variance: row.budget - projected,
        percentUsed: row.budget > 0 ? (projected / row.budget) * 100 : 0,
      }
    })
}

export function BudgetPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const currentMonth = new Date().toISOString().slice(0, 7)
  const {
    run: post,
    busy,
    error: err,
    setError: setErr,
  } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [budgetMonth, setBudgetMonth] = useState(currentMonth)
  const [budgetCategory, setBudgetCategory] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState('LKR')
  const [templateName, setTemplateName] = useState('')
  const [templateApplyMonth, setTemplateApplyMonth] = useState(currentMonth)
  const [budgetExplanation, setBudgetExplanation] = useState<string | null>(null)
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [expenseVendor, setExpenseVendor] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCurrency, setExpenseCurrency] = useState('LKR')
  const [thresholdPct, setThresholdPct] = useState(
    String(payload.budgetAlertThresholdPct),
  )
  const projectedSpend = buildProjectedSpend(
    currentMonth,
    payload.budgetVsActual,
    payload.data.expense_records,
  )
  const committedSpend = buildCommittedSpend(
    currentMonth,
    payload.data.expense_records,
  )
  const budgetRollover = buildBudgetRollover(
    currentMonth,
    payload.budgetVsActual,
    payload.data.budget_categories,
    payload.data.expense_records,
  )

  async function saveThreshold() {
    const data = await post(
      {
        action: 'set_budget_alert_threshold',
        pct: Number(thresholdPct) || 80,
      },
      'threshold',
    )
    if (data) setThresholdPct(String(data.budgetAlertThresholdPct))
  }

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

  async function saveCurrentBudgetTemplate() {
    const lines = payload.data.budget_categories
      .filter((row) => stringField(row, 'month') === budgetMonth)
      .map((row) => ({
        category: stringField(row, 'category') || 'Other',
        currency: stringField(row, 'currency') || 'LKR',
        budgetAmount: numberField(row, 'budgetAmount'),
      }))
      .filter((line) => line.budgetAmount > 0)
    if (!templateName.trim()) {
      setErr('Template name is required')
      return
    }
    if (lines.length === 0) {
      setErr(`Add at least one budget for ${budgetMonth} before saving a template`)
      return
    }
    const data = await post(
      { action: 'save_budget_template', template: { name: templateName.trim(), lines } },
      'template-save',
    )
    if (data) setTemplateName('')
  }

  async function applyBudgetTemplate(templateId: string) {
    await post(
      { action: 'apply_budget_template', templateId, month: templateApplyMonth },
      `template-apply-${templateId}`,
    )
  }

  async function removeBudgetTemplate(templateId: string) {
    await post(
      { action: 'delete_budget_template', id: templateId },
      `template-delete-${templateId}`,
    )
  }

  async function explainBudget() {
    const data = await post(
      {
        action: 'ask_finance_question',
        question: `Explain my ${currentMonth} budget versus actual spending. Identify the categories most over or under budget, mention projected spend and rollover when present, and give at most three practical observations. Use only the recorded data and clearly say when there is not enough data.`,
      },
      'budget-explain',
    ) as (PersonalFinancePayload & { answer?: string }) | undefined
    if (data?.answer) setBudgetExplanation(data.answer)
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Budget vs. actual spending</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Set a monthly budget per category, log expenses, and see how actual
            spending compares — updates instantly below. Enter budgets in LKR;
            actual spend is compared using LKR totals.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 lg:col-span-2">
          <h3 className="text-sm font-semibold">Budget warning threshold</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Highlight a category when spending reaches this percentage of its budget.
            The value is kept between 50% and 100%.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="number"
              min="50"
              max="100"
              value={thresholdPct}
              onChange={(e) => setThresholdPct(e.target.value)}
              className={`${inputClass} w-24`}
              aria-label="Budget warning threshold percentage"
            />
            <span className="text-sm">%</span>
            <button
              type="button"
              disabled={busy === 'threshold'}
              onClick={() => void saveThreshold()}
              className={buttonClass}
            >
              {busy === 'threshold' ? 'Saving...' : 'Save threshold'}
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
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
              list="pf-known-categories"
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

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 lg:col-span-2">
          <h3 className="text-sm font-semibold">Budget templates</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Save the budgets from a month as a reusable plan. Applying a template only fills missing categories and never overwrites an existing budget.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Template name (e.g. Normal month)"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className={`${inputClass} min-w-56`}
            />
            <button
              type="button"
              disabled={busy === 'template-save'}
              onClick={() => void saveCurrentBudgetTemplate()}
              className={buttonClass}
            >
              {busy === 'template-save' ? 'Saving...' : `Save ${budgetMonth} as template`}
            </button>
            <input
              type="month"
              value={templateApplyMonth}
              onChange={(e) => setTemplateApplyMonth(e.target.value)}
              className={inputClass}
              aria-label="Template target month"
            />
          </div>
          {(payload.budgetTemplates ?? []).length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {(payload.budgetTemplates ?? []).map((template) => (
                <div key={template.id} className="rounded-xl border border-[var(--theme-border)]/60 p-2.5 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{template.name}</div>
                      <div className="mt-1 text-[var(--theme-muted)]">
                        {template.lines.length} categor{template.lines.length === 1 ? 'y' : 'ies'} · {template.lines.map((line) => formatMoney(line.budgetAmount, line.currency)).join(' + ')}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="text-[var(--theme-muted)] underline"
                      disabled={busy === `template-delete-${template.id}`}
                      onClick={() => void removeBudgetTemplate(template.id)}
                    >
                      Delete
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`${buttonClass} mt-2 w-full`}
                    disabled={busy === `template-apply-${template.id}`}
                    onClick={() => void applyBudgetTemplate(template.id)}
                  >
                    {busy === `template-apply-${template.id}` ? 'Applying...' : `Apply to ${templateApplyMonth}`}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold">AI budget explanation</h3>
              <p className="mt-1 text-xs text-[var(--theme-muted)]">
                Summarizes this month’s recorded budget, actuals, projections, and rollover. It does not change any data.
              </p>
            </div>
            <button
              type="button"
              disabled={busy === 'budget-explain'}
              onClick={() => void explainBudget()}
              className={buttonClass}
            >
              {busy === 'budget-explain' ? 'Explaining…' : 'Explain this budget'}
            </button>
          </div>
          {budgetExplanation && (
            <p className="mt-3 rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-3 text-sm leading-6 text-[var(--theme-text)]">
              {budgetExplanation}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3">
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
              list="pf-known-categories"
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

      {err && <p className="mt-3 text-xs text-[var(--theme-danger)]">{err}</p>}

      {committedSpend.totalLkr > 0 && (
        <div className="mt-4 rounded-2xl border border-[var(--theme-border)]/70 p-3">
          <h3 className="text-sm font-semibold">Recorded committed spend</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            {formatLkr(committedSpend.totalLkr)} this month from expenses explicitly marked recurring. Unrecorded commitments are excluded.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {committedSpend.categories.map((row) => (
              <span key={row.category} className="rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-2.5 py-1 text-xs">
                {row.category}: {formatLkr(row.amountLkr)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <h3 className="text-sm font-semibold">This month ({currentMonth})</h3>
        {payload.budgetVsActual.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--theme-muted)]">
            No budgets set for this month yet — add one above to see how actual
            spending compares.
          </p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {payload.budgetVsActual.map((row) => (
              <StatCard
                key={`${row.month}-${row.category}`}
                label={`${row.category} — ${row.actualConversionAvailable === false ? 'FX unavailable' : `${Math.round(row.percentUsed)}% used${row.approachingBudget ? ' · Approaching' : ''}`}`}
                value={row.actualConversionAvailable === false
                  ? `Add a dated ${row.currency}/LKR rate to compare this budget`
                  : `${formatMoney(row.actual, row.currency)} / ${formatMoney(row.budget, row.currency)} · ${row.variance >= 0 ? 'Remaining' : 'Over by'} ${formatMoney(Math.abs(row.variance), row.currency)}`}
                tone={budgetTone(row)}
              />
            ))}
          </div>
        )}
      </div>

      {projectedSpend.length > 0 && (
        <div className="mt-5 rounded-2xl border border-[var(--theme-border)]/70 p-3">
          <h3 className="text-sm font-semibold">Projected month-end spend</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            LKR run-rate estimate plus explicitly future-dated recurring entries; it does not invent unrecorded bills.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {projectedSpend.map((row) => (
              <StatCard
                key={`projected-${row.category}`}
                label={`${row.category} — ${Math.round(row.percentUsed)}% projected`}
                value={`${formatLkr(row.projected)} / ${formatLkr(row.budget)}`}
                tone={budgetTone({
                  percentUsed: row.percentUsed,
                  approachingBudget: row.percentUsed >= payload.budgetAlertThresholdPct,
                  overBudget: row.projected > row.budget,
                })}
              />
            ))}
          </div>
        </div>
      )}

      {budgetRollover.some((row) => row.rollover > 0) && (
        <div className="mt-5 rounded-2xl border border-[var(--theme-border)]/70 p-3">
          <h3 className="text-sm font-semibold">Available with rollover</h3>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Unused prior-month LKR budget shown as a read-only carry-forward; saved budgets are unchanged.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {budgetRollover.filter((row) => row.rollover > 0).map((row) => (
              <span key={`rollover-${row.category}`} className="rounded-xl bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-2.5 py-1 text-xs">
                {row.category}: {formatLkr(row.available)} available ({formatLkr(row.rollover)} rollover)
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 border-t border-[var(--theme-border)]/70 pt-4">
        <h3 className="text-sm font-semibold">
          Year to date ({new Date().getUTCFullYear()})
        </h3>
        {payload.annualBudgetVsActual.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--theme-muted)]">
            Add monthly budgets to see an annual rollup.
          </p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {payload.annualBudgetVsActual.map((row) => (
              <StatCard
                key={`annual-${row.year}-${row.category}`}
                label={`${row.category} — ${row.actualConversionAvailable === false ? 'FX unavailable' : `${Math.round(row.percentUsed)}% used · ${row.monthsTracked} month${row.monthsTracked === 1 ? '' : 's'}`}`}
                value={row.actualConversionAvailable === false
                  ? `Add a dated ${row.currency}/LKR rate to compare this budget`
                  : `${formatMoney(row.actual, row.currency)} / ${formatMoney(row.budget, row.currency)} · ${row.variance >= 0 ? 'Remaining' : 'Over by'} ${formatMoney(Math.abs(row.variance), row.currency)}`}
                tone={budgetTone(row)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
