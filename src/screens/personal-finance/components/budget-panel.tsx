import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { StatCard } from '../../finance/components/stat-card'
import { formatLkr } from '../utils'
import {
  buttonClass,
  confirmButtonClass,
  dangerButtonClass,
  inputClass,
} from '../shared-styles'
import { boolField, numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

function budgetTone(percentUsed: number): 'good' | 'warn' | 'danger' {
  if (percentUsed > 100) return 'danger'
  if (percentUsed >= 80) return 'warn'
  return 'good'
}

type BudgetDraft = {
  month: string
  category: string
  budgetAmount: string
  currency: string
  rolloverEnabled: boolean
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
  // PF-201: a budget is a plan in the currency the user thinks in — default it
  // to the configured reporting currency. It's stored in that currency;
  // getBudgetVsActual converts it to LKR for the vs-actual comparison.
  const [budgetCurrency, setBudgetCurrency] = useState(payload.baseCurrency)
  const [budgetRollover, setBudgetRollover] = useState(false)
  const [copyingBudgets, setCopyingBudgets] = useState(false)
  const [copyNote, setCopyNote] = useState<string | null>(null)
  const budgetCurrencyOptions = [
    ...new Set([payload.baseCurrency, 'LKR', 'USD', 'AUD']),
  ]
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [expenseVendor, setExpenseVendor] = useState('')
  const [expenseCategory, setExpenseCategory] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseCurrency, setExpenseCurrency] = useState('LKR')

  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, BudgetDraft>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const allBudgets = [...payload.data.budget_categories].sort((a, b) =>
    stringField(a, 'month') < stringField(b, 'month') ? 1 : -1,
  )

  function startEdit(row: Record<string, unknown>) {
    const id = stringField(row, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        month: stringField(row, 'month'),
        category: stringField(row, 'category'),
        budgetAmount: String(numberField(row, 'budgetAmount')),
        currency: stringField(row, 'currency') || 'LKR',
        rolloverEnabled: boolField(row, 'rolloverEnabled'),
      },
    }))
    setEditOpenId(id)
  }

  async function saveEdit(id: string) {
    const draft = editDrafts[id]
    if (!draft.category.trim()) {
      setErr('Category is required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'budget_category',
        id,
        payload: {
          month: draft.month,
          category: draft.category.trim(),
          currency: draft.currency,
          budgetAmount: Number(draft.budgetAmount) || 0,
          rolloverEnabled: draft.rolloverEnabled,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  async function copyLastMonth() {
    setCopyingBudgets(true)
    setErr(null)
    setCopyNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'copy_budgets_to_month', targetMonth: currentMonth }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        copied?: number
        skippedExisting?: number
      }
      if (data.ok === false) {
        setErr(data.error || 'Could not copy budgets')
        return
      }
      onPayload(data as unknown as PersonalFinancePayload)
      setCopyNote(
        `Copied ${data.copied ?? 0} budget(s) from the prior month${
          (data.skippedExisting ?? 0) > 0
            ? ` (${data.skippedExisting} already had a budget this month, left untouched)`
            : ''
        }.`,
      )
    } finally {
      setCopyingBudgets(false)
    }
  }

  async function deleteBudget(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'budget_category', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
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
          rolloverEnabled: budgetRollover,
        },
      },
      'budget',
    )
    if (data) {
      setBudgetCategory('')
      setBudgetAmount('')
      setBudgetRollover(false)
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

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Budget vs. actual spending</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Set a monthly budget per category, log expenses, and see how actual
            spending compares — updates instantly below. A non-LKR budget is
            converted at the exchange rate on file; the comparison is always in
            LKR-converted terms.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
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
              {budgetCurrencyOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-[var(--theme-muted)]">
              <input
                type="checkbox"
                checked={budgetRollover}
                onChange={(e) => setBudgetRollover(e.target.checked)}
              />
              Roll over unspent amount
            </label>
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

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">This month ({currentMonth})</h3>
          <button
            type="button"
            disabled={copyingBudgets}
            onClick={() => void copyLastMonth()}
            className={buttonClass}
          >
            {copyingBudgets ? 'Copying…' : "Copy last month's budgets"}
          </button>
        </div>
        {copyNote && (
          <p className="mt-1 text-xs text-[var(--theme-muted)]">{copyNote}</p>
        )}
        {payload.budgetVsActual.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--theme-muted)]">
            No budgets set for this month yet — add one above, or copy last
            month's forward with the button above.
          </p>
        ) : (
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {payload.budgetVsActual.map((row) => (
              <StatCard
                key={`${row.month}-${row.category}`}
                label={`${row.category} — ${Math.round(row.percentUsed)}% used`}
                value={`${formatLkr(row.actual, row.currency)} / ${formatLkr(row.budget, row.currency)} · ${row.variance >= 0 ? 'Remaining' : 'Over by'} ${formatLkr(Math.abs(row.variance), row.currency)}`}
                tone={budgetTone(row.percentUsed)}
              />
            ))}
          </div>
        )}
      </div>

      {allBudgets.length > 0 && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold">All budgets</h3>
          <div className="mt-2 grid gap-2">
            {allBudgets.map((row, index) => {
              const id = stringField(row, 'id') || String(index)
              const isEditing = editOpenId === id
              return (
                <div
                  key={id}
                  className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
                >
                  {isEditing ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="month"
                        value={editDrafts[id].month}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [id]: { ...prev[id], month: e.target.value },
                          }))
                        }
                        className={inputClass}
                      />
                      <input
                        type="text"
                        placeholder="Category"
                        value={editDrafts[id].category}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [id]: { ...prev[id], category: e.target.value },
                          }))
                        }
                        list="pf-known-categories"
                        className={inputClass}
                      />
                      <input
                        type="number"
                        placeholder="Budget amount"
                        value={editDrafts[id].budgetAmount}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [id]: { ...prev[id], budgetAmount: e.target.value },
                          }))
                        }
                        className={`${inputClass} w-32`}
                      />
                      <select
                        value={editDrafts[id].currency}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [id]: { ...prev[id], currency: e.target.value },
                          }))
                        }
                        className={inputClass}
                      >
                        {budgetCurrencyOptions.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-[var(--theme-muted)]">
                        <input
                          type="checkbox"
                          checked={editDrafts[id].rolloverEnabled}
                          onChange={(e) =>
                            setEditDrafts((prev) => ({
                              ...prev,
                              [id]: { ...prev[id], rolloverEnabled: e.target.checked },
                            }))
                          }
                        />
                        Roll over unspent
                      </label>
                      <button
                        type="button"
                        disabled={busy === `edit-${id}`}
                        onClick={() => void saveEdit(id)}
                        className={confirmButtonClass}
                      >
                        {busy === `edit-${id}` ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditOpenId(null)}
                        className={buttonClass}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-[var(--theme-text)]">
                        <span className="text-[var(--theme-muted)]">
                          {stringField(row, 'month')}
                        </span>{' '}
                        · {stringField(row, 'category')} ·{' '}
                        {formatLkr(
                          numberField(row, 'budgetAmount'),
                          stringField(row, 'currency') || 'LKR',
                        )}
                        {boolField(row, 'rolloverEnabled') && (
                          <span className="ml-1 text-[var(--theme-muted)]">
                            (rolls over)
                          </span>
                        )}
                      </span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(row)}
                          className={buttonClass}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy === `delete-${id}`}
                          onClick={() => setConfirmDeleteId(id)}
                          className={dangerButtonClass}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this budget?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteBudget(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
