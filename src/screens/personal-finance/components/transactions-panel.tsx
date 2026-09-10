import { useEffect, useMemo, useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatMoney } from '../utils'
import { buttonClass, confirmButtonClass, dangerButtonClass, inputClass } from '../shared-styles'
import { numberField, splitTags, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

type TxnKind = 'income' | 'expense' | 'transfer'

/** Rows rendered before the "show more" cut — keeps the DOM bounded on a
 *  many-year history. Filters/search still run over the whole list. */
const RENDER_PAGE = 100

/**
 * PF review D1: the payload no longer ships a pre-unified `transactions` array
 * (it duplicated `data.income_records` + `data.expense_records`). This mirrors
 * the server's `getUnifiedTransactions` shape from the two raw arrays, which
 * are already `maskSensitive`-d in the payload.
 */
export function unifyTransactions(
  income: ReadonlyArray<Record<string, unknown>>,
  expense: ReadonlyArray<Record<string, unknown>>,
  transfers: ReadonlyArray<Record<string, unknown>> = [],
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [
    ...income.map((r) => ({
      id: r.id,
      kind: 'income',
      date: r.dateReceived,
      counterparty: r.sourceName,
      category: r.incomeType,
      accountId: r.accountId,
      currency: r.originalCurrency,
      amount: r.originalAmount,
      convertedLkrAmount: r.convertedLkrAmount,
      notes: r.notes,
      documentRef: r.documentRef,
      taxable: r.taxable,
      incomeSourceId: r.incomeSourceId,
      tags: r.tags,
      status: r.status,
      source: r.source,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    ...expense.map((r) => ({
      id: r.id,
      kind: 'expense',
      date: r.date,
      counterparty: r.vendor,
      category: r.category,
      accountId: r.accountId,
      currency: r.currency,
      amount: r.amount,
      convertedLkrAmount: r.convertedLkrAmount,
      notes: r.notes,
      documentRef: r.documentRef,
      recurring: r.recurring,
      subcategory: r.subcategory,
      splits: r.splits,
      tags: r.tags,
      status: r.status,
      source: r.source,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    ...transfers.map((r) => ({
      id: r.id,
      kind: 'transfer',
      date: r.date,
      counterparty: [r.fromAccountId, r.toAccountId].filter(Boolean).join(' → '),
      category: 'Transfer',
      accountId: r.fromAccountId,
      fromAccountId: r.fromAccountId,
      toAccountId: r.toAccountId,
      currency: r.currency,
      amount: r.amount,
      convertedLkrAmount: r.convertedLkrAmount,
      notes: r.notes,
      source: r.source,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  ]
  return rows.sort((a, b) => {
    const ad = String(a.date ?? '')
    const bd = String(b.date ?? '')
    if (ad !== bd) return ad < bd ? 1 : -1
    return String(a.createdAt ?? '') < String(b.createdAt ?? '') ? 1 : -1
  })
}

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

/** One row of the split editor — strings while typing, parsed on submit. */
type SplitRow = { category: string; amount: string }

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
  // transfer-only legs
  fromAccountId: string
  toAccountId: string
  // expense-only: category splits ([] = not split)
  splits: Array<SplitRow>
}

/**
 * PF review item 2: split one expense across several categories. Rows of
 * {category, amount}; the parts must sum to the expense amount. Returns
 * `null` (⇒ send no `splits`, or `[]` to clear) when there are fewer than
 * two rows.
 */
function SplitsField({
  rows,
  expenseAmount,
  onChange,
}: {
  rows: Array<SplitRow>
  expenseAmount: number
  onChange: (rows: Array<SplitRow>) => void
}) {
  const assigned = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
  const remaining = Math.round((expenseAmount - assigned) * 100) / 100
  return (
    <div className="mt-2 w-full rounded-xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_5%,transparent)] p-2">
      <div className="mb-1 flex items-center justify-between text-[11px] text-[var(--theme-muted)]">
        <span>Split across categories</span>
        <span
          className={
            Math.abs(remaining) > 0.01
              ? 'text-[var(--theme-warning)]'
              : 'text-[var(--theme-success)]'
          }
        >
          {Math.abs(remaining) > 0.01
            ? `${remaining > 0 ? 'Unassigned' : 'Over by'} ${Math.abs(remaining)}`
            : '✓ balanced'}
        </span>
      </div>
      {rows.map((row, i) => (
        <div key={i} className="mb-1 flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Category"
            value={row.category}
            onChange={(e) => {
              const next = rows.slice()
              next[i] = { ...next[i], category: e.target.value }
              onChange(next)
            }}
            list="pf-known-categories"
            className={inputClass}
          />
          <input
            type="number"
            placeholder="Amount"
            value={row.amount}
            onChange={(e) => {
              const next = rows.slice()
              next[i] = { ...next[i], amount: e.target.value }
              onChange(next)
            }}
            className={`${inputClass} w-28`}
          />
          <button
            type="button"
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="text-xs text-[var(--theme-danger)]"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...rows,
            {
              category: '',
              amount: remaining > 0 ? String(remaining) : '',
            },
          ])
        }
        className="text-xs font-medium text-[var(--theme-text)] underline"
      >
        + Add split
      </button>
    </div>
  )
}

/** Parse split rows → payload `splits` (or `[]` to clear when <2 valid rows). */
function toSplitsPayload(
  rows: Array<SplitRow>,
): Array<{ category: string; amount: number }> {
  const valid = rows
    .map((r) => ({
      category: r.category.trim() || 'Other',
      amount: Number(r.amount) || 0,
    }))
    .filter((r) => r.amount > 0)
  return valid.length >= 2 ? valid : []
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
  // Item 2: category splits for the expense being added ([] = not split).
  const [addSplits, setAddSplits] = useState<Array<SplitRow>>([])
  // Item 12 UI: account-to-account transfer.
  const [transferFrom, setTransferFrom] = useState('')
  const [transferTo, setTransferTo] = useState('')

  // Item 7: the payload only ships the trailing `transactionsWindowMonths` of
  // history. "Load full history" pages the rest in via the `list_transactions`
  // action; once loaded it becomes the source list until the next mutation
  // (which would make it stale) or an explicit reset.
  const [fullHistory, setFullHistory] = useState<Array<
    Record<string, unknown>
  > | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)

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
  const incomeRecords = payload.data.income_records
  const expenseRecords = payload.data.expense_records
  const transferRecords = payload.data.transfers
  const windowedTransactions = useMemo(
    () => unifyTransactions(incomeRecords, expenseRecords, transferRecords),
    [incomeRecords, expenseRecords, transferRecords],
  )
  const transactions = fullHistory ?? windowedTransactions

  async function loadFullHistory() {
    setHistoryBusy(true)
    setHistoryError(null)
    try {
      const rows: Array<Record<string, unknown>> = []
      let cursor: string | null = null
      // Bounded loop — 500 rows/page, cap at 200 pages (100k txns).
      for (let guard = 0; guard < 200; guard += 1) {
        const res: Response = await fetch('/api/finance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'list_transactions',
            limit: 500,
            cursor: cursor ?? undefined,
          }),
        })
        const data = (await res.json()) as {
          ok?: boolean
          error?: string
          transactions?: Array<Record<string, unknown>>
          nextCursor?: string | null
        }
        if (!res.ok || !data.ok) {
          setHistoryError(data.error ?? 'Could not load full history.')
          return
        }
        rows.push(...(data.transactions ?? []))
        cursor = data.nextCursor ?? null
        if (!cursor) break
      }
      setFullHistory(rows)
    } catch {
      setHistoryError('Could not load full history.')
    } finally {
      setHistoryBusy(false)
    }
  }

  // A mutation invalidates a loaded full-history snapshot — drop back to the
  // (freshly refetched) payload window so edited rows don't linger.
  async function mutate(
    body: Record<string, unknown>,
    busyKey?: string,
  ): Promise<PersonalFinancePayload | undefined> {
    const data = await post(body, busyKey)
    if (data) setFullHistory(null)
    return data
  }

  async function submitTransaction() {
    const busyKey = 'add-transaction'

    if (addKind === 'transfer') {
      const amt = Number(amount) || 0
      if (amt <= 0) {
        setErr('Transfer amount must be greater than 0')
        return
      }
      if (transferFrom && transferTo && transferFrom === transferTo) {
        setErr('“From” and “To” accounts must differ')
        return
      }
      const data = await mutate(
        {
          action: 'add_record',
          kind: 'transfer',
          payload: {
            date,
            fromAccountId: transferFrom || undefined,
            toAccountId: transferTo || undefined,
            amount: amt,
            currency,
            convertedLkrAmount: amt,
            notes: notes.trim() || undefined,
          },
        },
        busyKey,
      )
      if (data) {
        setAmount('')
        setNotes('')
        setTransferFrom('')
        setTransferTo('')
        setDate(todayIso())
      }
      return
    }

    if (!counterparty.trim()) {
      setErr(
        addKind === 'income' ? 'Source name is required' : 'Vendor is required',
      )
      return
    }
    const shared = {
      accountId: accountId || undefined,
      notes: notes.trim() || undefined,
      tags: tags.trim() || undefined,
      status,
    }
    const expenseAmount = Number(amount) || 0
    const splitsPayload =
      addKind === 'expense' ? toSplitsPayload(addSplits) : []
    if (splitsPayload.length) {
      const splitSum = splitsPayload.reduce((s, p) => s + p.amount, 0)
      if (Math.abs(splitSum - expenseAmount) > 0.01) {
        setErr(
          `Split parts (${splitSum}) must add up to the amount (${expenseAmount})`,
        )
        return
      }
    }
    const data =
      addKind === 'income'
        ? await mutate(
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
        : await mutate(
            {
              action: 'add_record',
              kind: 'expense',
              payload: {
                date,
                vendor: counterparty.trim(),
                category: category.trim() || 'Other',
                subcategory: subcategory.trim() || undefined,
                splits: splitsPayload.length ? splitsPayload : undefined,
                currency,
                amount: expenseAmount,
                convertedLkrAmount: expenseAmount,
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
      setAddSplits([])
    }
  }

  function startEdit(txn: Record<string, unknown>) {
    const id = stringField(txn, 'id')
    // Unified rows don't carry `splits` — read them off the raw expense record.
    const rawExpense = expenseRecords.find((r) => stringField(r, 'id') === id)
    const rawSplitsValue = rawExpense ? rawExpense.splits : undefined
    const rawSplits = Array.isArray(rawSplitsValue)
      ? (rawSplitsValue as Array<Record<string, unknown>>).map((s) => ({
          category: stringField(s, 'category'),
          amount: String(numberField(s, 'amount')),
        }))
      : []
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
        fromAccountId: stringField(txn, 'fromAccountId'),
        toAccountId: stringField(txn, 'toAccountId'),
        splits: rawSplits,
      },
    }))
    setEditOpenId(id)
  }

  function cancelEdit() {
    setEditOpenId(null)
  }

  async function saveEdit(id: string, kind: TxnKind) {
    const draft = editDrafts[id]

    if (kind === 'transfer') {
      const amt = Number(draft.amount) || 0
      if (amt <= 0) {
        setErr('Transfer amount must be greater than 0')
        return
      }
      if (
        draft.fromAccountId &&
        draft.toAccountId &&
        draft.fromAccountId === draft.toAccountId
      ) {
        setErr('“From” and “To” accounts must differ')
        return
      }
      const data = await mutate(
        {
          action: 'update_record',
          kind: 'transfer',
          id,
          payload: {
            date: draft.date,
            fromAccountId: draft.fromAccountId || undefined,
            toAccountId: draft.toAccountId || undefined,
            amount: amt,
            currency: draft.currency,
            convertedLkrAmount: amt,
            notes: draft.notes.trim() || undefined,
          },
        },
        `edit-${id}`,
      )
      if (data) setEditOpenId(null)
      return
    }

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
    const editAmount = Number(draft.amount) || 0
    const editSplits = kind === 'expense' ? toSplitsPayload(draft.splits) : []
    if (editSplits.length) {
      const splitSum = editSplits.reduce((s, p) => s + p.amount, 0)
      if (Math.abs(splitSum - editAmount) > 0.01) {
        setErr(
          `Split parts (${splitSum}) must add up to the amount (${editAmount})`,
        )
        return
      }
    }
    const data =
      kind === 'income'
        ? await mutate(
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
        : await mutate(
            {
              action: 'update_record',
              kind: 'expense',
              id,
              payload: {
                date: draft.date,
                vendor: draft.counterparty.trim(),
                category: draft.category.trim() || 'Other',
                subcategory: draft.subcategory.trim() || undefined,
                // Always send `splits` on an expense edit: a non-empty array
                // replaces, `[]` clears — so an amount change can't silently
                // leave stale parts behind.
                splits: editSplits,
                currency: draft.currency,
                amount: editAmount,
                convertedLkrAmount: editAmount,
                recurring: draft.recurring,
                ...shared,
              },
            },
            `edit-${id}`,
          )
    if (data) setEditOpenId(null)
  }

  async function deleteTransaction(id: string, kind: TxnKind) {
    const data = await mutate(
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

  // Cap how many rows are in the DOM. Reset to the first page whenever the
  // filters change, so narrowing to 5 results never shows a stale "300 of 5".
  const [visibleCount, setVisibleCount] = useState(RENDER_PAGE)
  useEffect(() => {
    setVisibleCount(RENDER_PAGE)
  }, [
    search,
    filterKind,
    filterStatus,
    dateFrom,
    dateTo,
    amountMin,
    amountMax,
    fullHistory,
  ])
  const visible = filtered.slice(0, visibleCount)

  const totalsByCurrency = new Map<string, number>()
  let incomeCount = 0
  let expenseCount = 0
  let transferCount = 0
  for (const txn of transactions) {
    const kind = stringField(txn, 'kind')
    if (kind === 'income') incomeCount += 1
    if (kind === 'expense') expenseCount += 1
    if (kind === 'transfer') {
      transferCount += 1
      // transfers move money between the user's own accounts — they net to
      // zero and must not shift the income/expense total.
      continue
    }
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
        A unified view of income, expenses and transfers — added here writes to
        the same underlying records shown elsewhere.
      </p>
      <p className="mt-2 text-sm font-medium text-[var(--theme-text)]">
        {incomeCount} income · {expenseCount} expense
        {transferCount > 0 && <> · {transferCount} transfer</>}
        {totalsText && (
          <>
            {' '}
            · net <span className="text-[var(--theme-success)]">{totalsText}</span>
          </>
        )}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="flex overflow-hidden rounded-xl border border-[var(--theme-border)]">
          <button
            type="button"
            onClick={() => setAddKind('income')}
            className={`px-3 py-1.5 text-xs font-medium ${addKind === 'income' ? 'bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] text-[var(--theme-success)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'}`}
          >
            Income
          </button>
          <button
            type="button"
            onClick={() => setAddKind('expense')}
            className={`px-3 py-1.5 text-xs font-medium ${addKind === 'expense' ? 'bg-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] text-[var(--theme-danger)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'}`}
          >
            Expense
          </button>
          <button
            type="button"
            onClick={() => setAddKind('transfer')}
            className={`px-3 py-1.5 text-xs font-medium ${addKind === 'transfer' ? 'bg-[color-mix(in_srgb,var(--theme-accent)_25%,transparent)] text-[var(--theme-accent)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'}`}
          >
            Transfer
          </button>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
        />
        {addKind === 'transfer' && (
          <>
            <select
              value={transferFrom}
              onChange={(e) => setTransferFrom(e.target.value)}
              className={inputClass}
              aria-label="From account"
            >
              <option value="">From account…</option>
              {accounts.map((account, index) => {
                const id = stringField(account, 'id') || String(index)
                return (
                  <option key={id} value={id}>
                    {stringField(account, 'name')}
                  </option>
                )
              })}
            </select>
            <select
              value={transferTo}
              onChange={(e) => setTransferTo(e.target.value)}
              className={inputClass}
              aria-label="To account"
            >
              <option value="">To account…</option>
              {accounts.map((account, index) => {
                const id = stringField(account, 'id') || String(index)
                return (
                  <option key={id} value={id}>
                    {stringField(account, 'name')}
                  </option>
                )
              })}
            </select>
          </>
        )}
        {addKind !== 'transfer' && (
          <>
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
            {addKind === 'expense' && addSplits.length > 0 && (
              <SplitsField
                rows={addSplits}
                expenseAmount={Number(amount) || 0}
                onChange={setAddSplits}
              />
            )}
            {addKind === 'expense' && addSplits.length === 0 && (
              <button
                type="button"
                onClick={() =>
                  setAddSplits([
                    { category: category.trim(), amount: amount || '' },
                    { category: '', amount: '' },
                  ])
                }
                className="self-center text-xs font-medium text-[var(--theme-text)] underline"
              >
                Split
              </button>
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
          </>
        )}
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
        {addKind !== 'transfer' && (
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
        )}
        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
        />
        {addKind === 'income' && (
          <label className="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
            <input
              type="checkbox"
              checked={taxable}
              onChange={(e) => setTaxable(e.target.checked)}
            />
            Taxable
          </label>
        )}
        {addKind === 'expense' && (
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
          {busy === 'add-transaction'
            ? 'Saving…'
            : addKind === 'transfer'
              ? 'Add transfer'
              : 'Add transaction'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-[var(--theme-danger)]">{err}</p>}

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
          <option value="transfer">Transfer</option>
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

      {fullHistory ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-[var(--theme-muted)]">
          <span>
            Showing full history —{' '}
            {fullHistory.length.toLocaleString('en-LK')} transactions.
          </span>
          <button
            type="button"
            onClick={() => setFullHistory(null)}
            className="font-medium text-[var(--theme-text)] underline"
          >
            Back to last {payload.transactionsWindowMonths} months
          </button>
        </p>
      ) : (
        payload.transactionsWindowMonths > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-[var(--theme-muted)]">
            <span>
              Showing the last {payload.transactionsWindowMonths} months.
            </span>
            <button
              type="button"
              onClick={() => void loadFullHistory()}
              disabled={historyBusy}
              className="rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_12%,transparent)] px-2 py-0.5 font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_20%,transparent)] disabled:opacity-50"
            >
              {historyBusy ? 'Loading…' : 'Load full history'}
            </button>
          </p>
        )
      )}
      {historyError && (
        <p className="mt-1 text-xs text-[var(--theme-danger)]">{historyError}</p>
      )}

      <div className="mt-3 grid gap-2">
        {filtered.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            No transactions match.
          </p>
        )}
        {visible.map((txn, index) => {
          const id = stringField(txn, 'id') || String(index)
          const kind = (stringField(txn, 'kind') || 'expense') as TxnKind
          const isEditing = editOpenId === id
          const txnCurrency = stringField(txn, 'currency') || 'LKR'
          const amountValue = numberField(txn, 'amount')
          const txnStatus = stringField(txn, 'status') || 'cleared'
          const documentRef = stringField(txn, 'documentRef')
          const txnSource = stringField(txn, 'source') || 'manual'
          const txnSplits = Array.isArray(txn.splits)
            ? (txn.splits as Array<Record<string, unknown>>)
            : []

          return (
            <div
              key={id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              {isEditing && kind === 'transfer' ? (
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
                  <select
                    value={editDrafts[id].fromAccountId}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], fromAccountId: e.target.value },
                      }))
                    }
                    className={inputClass}
                    aria-label="From account"
                  >
                    <option value="">From account…</option>
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
                  <select
                    value={editDrafts[id].toAccountId}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], toAccountId: e.target.value },
                      }))
                    }
                    className={inputClass}
                    aria-label="To account"
                  >
                    <option value="">To account…</option>
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
                  <button
                    type="button"
                    disabled={busy === `edit-${id}`}
                    onClick={() => void saveEdit(id, kind)}
                    className={confirmButtonClass}
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
              ) : isEditing ? (
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
                  {kind === 'expense' &&
                    (editDrafts[id].splits.length > 0 ? (
                      <SplitsField
                        rows={editDrafts[id].splits}
                        expenseAmount={Number(editDrafts[id].amount) || 0}
                        onChange={(next) =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [id]: { ...prev[id], splits: next },
                          }))
                        }
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setEditDrafts((prev) => ({
                            ...prev,
                            [id]: {
                              ...prev[id],
                              splits: [
                                {
                                  category: prev[id].category,
                                  amount: prev[id].amount,
                                },
                                { category: '', amount: '' },
                              ],
                            },
                          }))
                        }
                        className="self-center text-xs font-medium text-[var(--theme-text)] underline"
                      >
                        Split
                      </button>
                    ))}
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
                    className={confirmButtonClass}
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
                      className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${kind === 'income' ? 'bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] text-[var(--theme-success)]' : kind === 'transfer' ? 'bg-[color-mix(in_srgb,var(--theme-accent)_25%,transparent)] text-[var(--theme-accent)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] text-[var(--theme-muted)]'}`}
                    >
                      {kind === 'income'
                        ? 'Income'
                        : kind === 'transfer'
                          ? 'Transfer'
                          : 'Expense'}
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
                    {txnSplits.length > 0 && (
                      <span className="ml-1 text-[10px] text-[var(--theme-muted)]">
                        (split:{' '}
                        {txnSplits
                          .map(
                            (s) =>
                              `${stringField(s, 'category') || 'Other'} ${formatMoney(
                                numberField(s, 'amount'),
                                txnCurrency,
                              )}`,
                          )
                          .join(' · ')}
                        )
                      </span>
                    )}
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
        {filtered.length > visibleCount && (
          <div className="flex items-center justify-between gap-3 pt-1 text-xs text-[var(--theme-muted)]">
            <span>
              Showing {visibleCount.toLocaleString('en-LK')} of{' '}
              {filtered.length.toLocaleString('en-LK')}
            </span>
            <button
              type="button"
              onClick={() =>
                setVisibleCount((n) => n + RENDER_PAGE * 5)
              }
              className={buttonClass}
            >
              Show more
            </button>
          </div>
        )}
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
