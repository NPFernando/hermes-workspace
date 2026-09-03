import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatMoney } from '../utils'
import { buttonClass, inputClass } from '../shared-styles'
import { numberField, splitTags, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

type TxnKind = 'income' | 'expense'

function boolField(row: Record<string, unknown>, key: string): boolean {
  return row[key] === true
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function merchantDefaultCategory(
  merchants: Array<Record<string, unknown>>,
  vendorName: string,
): string | undefined {
  const match = merchants.find((m) => stringField(m, 'name') === vendorName)
  const defaultCategory = match ? stringField(match, 'defaultCategory') : ''
  return defaultCategory || undefined
}

type EditDraft = {
  date: string
  counterparty: string
  category: string
  subcategory: string
  tags: string
  status: string
  currency: string
  amount: string
  accountId: string
  notes: string
  taxable: boolean
  recurring: boolean
}

/**
 * Unified Transactions — additive read+CRUD layer over income_records +
 * expense_records (PF-104). Storage stays split (financeSummary/budgetVsActual
 * keep reading the original collections unchanged); this panel only presents
 * both as one list and routes adds/edits/deletes to the correct existing
 * `kind: 'income' | 'expense'` under the hood.
 */
export function TransactionsPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const {
    run: post,
    busy,
    error: err,
    setError: setErr,
  } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, EditDraft>>({})

  const [addKind, setAddKind] = useState<TxnKind>('expense')
  const [date, setDate] = useState(todayIso())
  const [counterparty, setCounterparty] = useState('')
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [tags, setTags] = useState('')
  const [status, setStatus] = useState('cleared')
  const [currency, setCurrency] = useState('LKR')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [notes, setNotes] = useState('')
  const [taxable, setTaxable] = useState(true)
  const [recurring, setRecurring] = useState(false)

  const [search, setSearch] = useState('')
  const [filterKind, setFilterKind] = useState<'all' | TxnKind>('all')
  const [filterStatus, setFilterStatus] = useState<
    'all' | 'pending' | 'cleared' | 'reconciled'
  >('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')

  const accounts = payload.data.finance_accounts
  const transactions = payload.transactions

  async function submitTransaction() {
    if (!counterparty.trim()) {
      setErr(
        addKind === 'income' ? 'Source name is required' : 'Vendor is required',
      )
      return
    }
    const busyKey = 'add-transaction'
    const shared = {
      accountId: accountId || undefined,
      notes: notes.trim() || undefined,
      tags: tags.trim() || undefined,
      status,
    }
    const data =
      addKind === 'income'
        ? await post(
            {
              action: 'add_record',
              kind: 'income',
              payload: {
                dateReceived: date,
                sourceName: counterparty.trim(),
                incomeType: category.trim() || 'Other income',
                originalCurrency: currency,
                originalAmount: Number(amount) || 0,
                convertedLkrAmount: Number(amount) || 0,
                taxable,
                ...shared,
              },
            },
            busyKey,
          )
        : await post(
            {
              action: 'add_record',
              kind: 'expense',
              payload: {
                date,
                vendor: counterparty.trim(),
                category: category.trim() || 'Other',
                subcategory: subcategory.trim() || undefined,
                currency,
                amount: Number(amount) || 0,
                convertedLkrAmount: Number(amount) || 0,
                recurring,
                ...shared,
              },
            },
            busyKey,
          )
    if (data) {
      setCounterparty('')
      setCategory('')
      setSubcategory('')
      setTags('')
      setStatus('cleared')
      setAmount('')
      setNotes('')
      setDate(todayIso())
    }
  }

  function startEdit(txn: Record<string, unknown>) {
    const id = stringField(txn, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        date: stringField(txn, 'date'),
        counterparty: stringField(txn, 'counterparty'),
        category: stringField(txn, 'category'),
        subcategory: stringField(txn, 'subcategory'),
        tags: stringField(txn, 'tags'),
        status: stringField(txn, 'status') || 'cleared',
        currency: stringField(txn, 'currency') || 'LKR',
        amount: String(numberField(txn, 'amount')),
        accountId: stringField(txn, 'accountId'),
        notes: stringField(txn, 'notes'),
        taxable: boolField(txn, 'taxable'),
        recurring: boolField(txn, 'recurring'),
      },
    }))
    setEditOpenId(id)
  }

  function cancelEdit() {
    setEditOpenId(null)
  }

  async function saveEdit(id: string, kind: TxnKind) {
    const draft = editDrafts[id]
    if (!draft.counterparty.trim()) {
      setErr(
        kind === 'income' ? 'Source name is required' : 'Vendor is required',
      )
      return
    }
    const shared = {
      accountId: draft.accountId || undefined,
      notes: draft.notes.trim() || undefined,
      tags: draft.tags.trim() || undefined,
      status: draft.status,
    }
    const data =
      kind === 'income'
        ? await post(
            {
              action: 'update_record',
              kind: 'income',
              id,
              payload: {
                dateReceived: draft.date,
                sourceName: draft.counterparty.trim(),
                incomeType: draft.category.trim() || 'Other income',
                originalCurrency: draft.currency,
                originalAmount: Number(draft.amount) || 0,
                convertedLkrAmount: Number(draft.amount) || 0,
                taxable: draft.taxable,
                ...shared,
              },
            },
            `edit-${id}`,
          )
        : await post(
            {
              action: 'update_record',
              kind: 'expense',
              id,
              payload: {
                date: draft.date,
                vendor: draft.counterparty.trim(),
                category: draft.category.trim() || 'Other',
                subcategory: draft.subcategory.trim() || undefined,
                currency: draft.currency,
                amount: Number(draft.amount) || 0,
                convertedLkrAmount: Number(draft.amount) || 0,
                recurring: draft.recurring,
                ...shared,
              },
            },
            `edit-${id}`,
          )
    if (data) setEditOpenId(null)
  }

  async function deleteTransaction(id: string, kind: TxnKind) {
    const data = await post(
      { action: 'delete_record', kind, id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return transactions.filter((txn) => {
      const kind = stringField(txn, 'kind')
      if (filterKind !== 'all' && kind !== filterKind) return false
      if (
        filterStatus !== 'all' &&
        (stringField(txn, 'status') || 'cleared') !== filterStatus
      )
        return false
      const txnDate = stringField(txn, 'date')
      if (dateFrom && txnDate < dateFrom) return false
      if (dateTo && txnDate > dateTo) return false
      const txnAmount = numberField(txn, 'amount')
      if (amountMin && txnAmount < Number(amountMin)) return false
      if (amountMax && txnAmount > Number(amountMax)) return false
      if (!term) return true
      const counterpartyValue = stringField(txn, 'counterparty').toLowerCase()
      const categoryValue = stringField(txn, 'category').toLowerCase()
      return counterpartyValue.includes(term) || categoryValue.includes(term)
    })
  }, [
    transactions,
    search,
    filterKind,
    filterStatus,
    dateFrom,
    dateTo,
    amountMin,
    amountMax,
  ])

  const totalsByCurrency = new Map<string, number>()
  let incomeCount = 0
  let expenseCount = 0
  for (const txn of transactions) {
    const kind = stringField(txn, 'kind')
    if (kind === 'income') incomeCount += 1
    if (kind === 'expense') expenseCount += 1
    const txnCurrency = stringField(txn, 'currency') || 'LKR'
    const signed =
      kind === 'income'
        ? numberField(txn, 'amount')
        : -numberField(txn, 'amount')
    totalsByCurrency.set(
      txnCurrency,
      (totalsByCurrency.get(txnCurrency) ?? 0) + signed,
    )
  }
  const totalsText = Array.from(totalsByCurrency.entries())
    .map(([entryCurrency, entryAmount]) =>
      formatMoney(entryAmount, entryCurrency),
    )
    .join(' · ')

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Transactions</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        A unified view of income and expenses — added here writes to the same
        underlying records shown elsewhere.
      </p>
      <p className="mt-2 text-sm font-medium text-[var(--theme-text)]">
        {incomeCount} income · {expenseCount} expense
        {totalsText && (
          <>
            {' '}
            · net <span className="text-emerald-300">{totalsText}</span>
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="flex overflow-hidden rounded-xl border border-[var(--theme-border)]">
          <button
            type="button"
            onClick={() => setAddKind('income')}
            className={`px-3 py-1.5 text-xs font-medium ${addKind === 'income' ? 'bg-emerald-500/25 text-emerald-100' : 'bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'}`}
          >
            Income
          </button>
          <button
            type="button"
            onClick={() => setAddKind('expense')}
            className={`px-3 py-1.5 text-xs font-medium ${addKind === 'expense' ? 'bg-red-500/25 text-red-100' : 'bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'}`}
          >
            Expense
          </button>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder={addKind === 'income' ? 'Source name' : 'Vendor'}
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          onBlur={() => {
            if (addKind !== 'expense' || category.trim()) return
            const guess = merchantDefaultCategory(
              payload.data.merchants,
              counterparty.trim(),
            )
            if (guess) setCategory(guess)
          }}
          list={addKind === 'expense' ? 'pf-known-merchants' : undefined}
          className={inputClass}
        />
        <input
          type="text"
          placeholder={addKind === 'income' ? 'Income type' : 'Category'}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list="pf-known-categories"
          className={inputClass}
        />
        {addKind === 'expense' && (
          <input
            type="text"
            placeholder="Subcategory (optional)"
            value={subcategory}
            onChange={(e) => setSubcategory(e.target.value)}
            list="pf-known-subcategories"
            className={inputClass}
          />
        )}
        <input
          type="text"
          placeholder="Tags (comma-separated, optional)"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          list="pf-known-tags"
          className={inputClass}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={inputClass}
        >
          <option value="pending">Pending</option>
          <option value="cleared">Cleared</option>
          <option value="reconciled">Reconciled</option>
        </select>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className={inputClass}
        >
          <option value="LKR">LKR</option>
          <option value="USD">USD</option>
          <option value="AUD">AUD</option>
        </select>
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className={`${inputClass} w-32`}
        />
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className={inputClass}
        >
          <option value="">No account</option>
          {accounts.map((account, index) => {
            const id = stringField(account, 'id') || String(index)
            return (
              <option key={id} value={id}>
                {stringField(account, 'name')}
              </option>
            )
          })}
        </select>
        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
        />
        {addKind === 'income' ? (
          <label className="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
            <input
              type="checkbox"
              checked={taxable}
              onChange={(e) => setTaxable(e.target.checked)}
            />
            Taxable
          </label>
        ) : (
          <label className="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
            />
            Recurring
          </label>
        )}
        <button
          type="button"
          disabled={busy === 'add-transaction'}
          onClick={() => void submitTransaction()}
          className={buttonClass}
        >
          {busy === 'add-transaction' ? 'Saving…' : 'Add transaction'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search by counterparty or category"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} w-64`}
        />
        <select
          value={filterKind}
          onChange={(e) => setFilterKind(e.target.value as 'all' | TxnKind)}
          className={inputClass}
        >
          <option value="all">All</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) =>
            setFilterStatus(
              e.target.value as 'all' | 'pending' | 'cleared' | 'reconciled',
            )
          }
          className={inputClass}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="cleared">Cleared</option>
          <option value="reconciled">Reconciled</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          title="From date"
          className={inputClass}
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          title="To date"
          className={inputClass}
        />
        <input
          type="number"
          placeholder="Min amount"
          value={amountMin}
          onChange={(e) => setAmountMin(e.target.value)}
          className={`${inputClass} w-28`}
        />
        <input
          type="number"
          placeholder="Max amount"
          value={amountMax}
          onChange={(e) => setAmountMax(e.target.value)}
          className={`${inputClass} w-28`}
        />
      </div>

      <div className="mt-3 grid gap-2">
        {filtered.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            No transactions match.
          </p>
        )}
        {filtered.map((txn, index) => {
          const id = stringField(txn, 'id') || String(index)
          const kind = (stringField(txn, 'kind') || 'expense') as TxnKind
          const isEditing = editOpenId === id
          const txnCurrency = stringField(txn, 'currency') || 'LKR'
          const amountValue = numberField(txn, 'amount')
          const txnStatus = stringField(txn, 'status') || 'cleared'
          const documentRef = stringField(txn, 'documentRef')
          const txnSource = stringField(txn, 'source') || 'manual'

          return (
            <div
              key={id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={editDrafts[id].date}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], date: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder={kind === 'income' ? 'Source name' : 'Vendor'}
                    value={editDrafts[id].counterparty}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], counterparty: e.target.value },
                      }))
                    }
                    onBlur={() => {
                      if (kind !== 'expense' || editDrafts[id].category.trim())
                        return
                      const guess = merchantDefaultCategory(
                        payload.data.merchants,
                        editDrafts[id].counterparty.trim(),
                      )
                      if (guess)
                        setEditDrafts((prev) => ({
                          ...prev,
                          [id]: { ...prev[id], category: guess },
                        }))
                    }}
                    list={kind === 'expense' ? 'pf-known-merchants' : undefined}
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder={kind === 'income' ? 'Income type' : 'Category'}
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
                  {kind === 'expense' && (
                    <input
                      type="text"
                      placeholder="Subcategory"
                      value={editDrafts[id].subcategory}
                      onChange={(e) =>
                        setEditDrafts((prev) => ({
                          ...prev,
                          [id]: { ...prev[id], subcategory: e.target.value },
                        }))
                      }
                      list="pf-known-subcategories"
                      className={inputClass}
                    />
                  )}
                  <input
                    type="text"
                    placeholder="Tags (comma-separated)"
                    value={editDrafts[id].tags}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], tags: e.target.value },
                      }))
                    }
                    list="pf-known-tags"
                    className={inputClass}
                  />
                  <select
                    value={editDrafts[id].status}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], status: e.target.value },
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="pending">Pending</option>
                    <option value="cleared">Cleared</option>
                    <option value="reconciled">Reconciled</option>
                  </select>
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
                    <option value="LKR">LKR</option>
                    <option value="USD">USD</option>
                    <option value="AUD">AUD</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Amount"
                    value={editDrafts[id].amount}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], amount: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-32`}
                  />
                  <select
                    value={editDrafts[id].accountId}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], accountId: e.target.value },
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="">No account</option>
                    {accounts.map((account, accountIndex) => {
                      const accountRowId =
                        stringField(account, 'id') || String(accountIndex)
                      return (
                        <option key={accountRowId} value={accountRowId}>
                          {stringField(account, 'name')}
                        </option>
                      )
                    })}
                  </select>
                  <input
                    type="text"
                    placeholder="Notes"
                    value={editDrafts[id].notes}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], notes: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  {kind === 'income' ? (
                    <label className="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
                      <input
                        type="checkbox"
                        checked={editDrafts[id].taxable}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [id]: { ...prev[id], taxable: e.target.checked },
                          }))
                        }
                      />
                      Taxable
                    </label>
                  ) : (
                    <label className="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
                      <input
                        type="checkbox"
                        checked={editDrafts[id].recurring}
                        onChange={(e) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [id]: { ...prev[id], recurring: e.target.checked },
                          }))
                        }
                      />
                      Recurring
                    </label>
                  )}
                  <button
                    type="button"
                    disabled={busy === `edit-${id}`}
                    onClick={() => void saveEdit(id, kind)}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {busy === `edit-${id}` ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className={buttonClass}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span
                      className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${kind === 'income' ? 'bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] text-[var(--theme-success)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] text-[var(--theme-muted)]'}`}
                    >
                      {kind === 'income' ? 'Income' : 'Expense'}
                    </span>
                    {txnStatus !== 'cleared' && (
                      <span
                        className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${txnStatus === 'pending' ? 'bg-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] text-[var(--theme-warning)]' : 'bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] text-[var(--theme-success)]'}`}
                      >
                        {txnStatus === 'pending' ? 'Pending' : 'Reconciled'}
                      </span>
                    )}
                    {txnSource !== 'manual' && (
                      <span className="mr-1.5 rounded-full bg-[color-mix(in_srgb,var(--theme-accent-secondary)_25%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--theme-accent-secondary)]">
                        {txnSource === 'gmail'
                          ? 'via Gmail'
                          : txnSource === 'upload'
                            ? 'via Upload'
                            : txnSource}
                      </span>
                    )}
                    <span className="font-medium text-[var(--theme-text)]">
                      {stringField(txn, 'counterparty')}
                    </span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      · {stringField(txn, 'category')}
                      {stringField(txn, 'subcategory') &&
                        ` / ${stringField(txn, 'subcategory')}`}{' '}
                      · {stringField(txn, 'date')} ·{' '}
                      {formatMoney(amountValue, txnCurrency)}
                    </span>
                    {splitTags(stringField(txn, 'tags')).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {splitTags(stringField(txn, 'tags')).map((t) => (
                          <span
                            key={t}
                            className="rounded-full border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-2 py-0.5 text-[10px] text-[var(--theme-muted)]"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {documentRef && (
                      <a
                        href={`/api/finance-document?kind=${kind === 'income' ? 'income_record' : 'expense_record'}&id=${id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonClass}
                      >
                        View document
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(txn)}
                      className={buttonClass}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy === `delete-${id}`}
                      onClick={() => setConfirmDeleteId(id)}
                      className="rounded-xl border border-red-400/30 bg-red-500/15 px-3 py-1.5 text-xs font-medium text-red-100 hover:bg-red-500/25 disabled:opacity-50"
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

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this transaction?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => {
            const txn = transactions.find(
              (t) => stringField(t, 'id') === confirmDeleteId,
            )
            const kind = (txn ? stringField(txn, 'kind') : 'expense') as TxnKind
            void deleteTransaction(confirmDeleteId, kind)
          }}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
