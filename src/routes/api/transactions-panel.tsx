import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatDateTime, formatMoney } from '../utils'
import { transactionAmountLabel } from '../transaction-display'
import { buttonClass, confirmButtonClass, dangerButtonClass, inputClass } from '../shared-styles'
import { numberField, splitTags, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

type TxnKind = 'income' | 'expense'
type LedgerKind = TxnKind | 'transfer' | 'split'
const AUDIT_PAGE_SIZE = 8

type ImportPreview = {
  fingerprint: string
  rowCount: number
  items: Array<unknown>
  errors: Array<string>
  duplicates: Array<{ rowNumbers: Array<number>; counterparty: string; amount: number }>
}

export function splitRowsFromPercents(
  rows: Array<{ category: string; percent: number }>,
  total: number,
): Array<{ category: string; amount: string }> {
  const safeTotal = Number.isFinite(total) ? total : 0
  let allocated = 0
  return rows.map((row, index) => {
    const amount = index === rows.length - 1
      ? Math.round((safeTotal - allocated) * 100) / 100
      : Math.round((safeTotal * row.percent / 100) * 100) / 100
    allocated += amount
    return { category: row.category, amount: String(amount) }
  })
}

export function unifyTransactions(
  income: Array<Record<string, any>>,
  expenses: Array<Record<string, any>>,
  transfers: Array<Record<string, any>> = [],
) {
  const rows = [
    ...income.map((row) => ({ id: row.id, kind: 'income', date: row.dateReceived, counterparty: row.sourceName, category: row.incomeType, accountId: row.accountId, currency: row.originalCurrency, amount: row.originalAmount, exchangeRateUsed: row.exchangeRateUsed, convertedLkrAmount: row.convertedLkrAmount, notes: row.notes, documentRef: row.documentRef, taxable: row.taxable, incomeSourceId: row.incomeSourceId, tags: row.tags, status: row.status, transactionType: row.transactionType ?? 'income', transferId: row.transferId, transferAccountId: row.transferAccountId, source: row.source, createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt })),
    ...expenses.map((row) => ({ id: row.id, kind: 'expense', date: row.date, counterparty: row.vendor, category: row.category, accountId: row.accountId, currency: row.currency, amount: row.amount, exchangeRateUsed: row.exchangeRateUsed, convertedLkrAmount: row.convertedLkrAmount, notes: row.notes, documentRef: row.documentRef, recurring: row.recurring, subcategory: row.subcategory, tags: row.tags, status: row.status, transactionType: row.transactionType ?? 'expense', transferId: row.transferId, transferAccountId: row.transferAccountId, splitGroupId: row.splitGroupId, splitIndex: row.splitIndex, source: row.source, createdAt: row.createdAt, updatedAt: row.updatedAt, deletedAt: row.deletedAt })),
    ...transfers.map((row) => ({ id: row.id, kind: 'transfer', date: row.date, counterparty: `${row.fromAccountId ?? ''} → ${row.toAccountId ?? ''}`, category: 'Transfer', accountId: row.fromAccountId, currency: row.currency, amount: row.amount, convertedLkrAmount: row.convertedLkrAmount ?? row.amount, status: row.status ?? 'cleared', notes: row.notes, source: row.source, createdAt: row.createdAt, updatedAt: row.updatedAt })),
  ]
  return rows.sort((a, b) => a.date === b.date ? String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) : String(b.date).localeCompare(String(a.date)))
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

function auditDetailText(details: Record<string, unknown>): string {
  const candidate = details.after ?? details.before
  const record = Array.isArray(candidate) ? candidate[0] : candidate
  if (!record || typeof record !== 'object') return 'transaction metadata changed'
  const row = record as Record<string, unknown>
  const counterparty = stringField(row, 'counterparty')
  const category = stringField(row, 'category')
  const amount = numberField(row, 'amount')
  const currency = stringField(row, 'currency')
  const label = [counterparty, category].filter(Boolean).join(' · ')
  return label
    ? `${label}${Number.isFinite(amount) ? ` · ${formatMoney(amount, currency || 'LKR')}` : ''}`
    : 'transaction metadata changed'
}

type EditDraft = {
  date: string
  counterparty: string
  category: string
  incomeSubtype: 'salary' | 'dividend' | 'interest' | 'freelance' | 'other'
  subcategory: string
  tags: string
  status: string
  currency: string
  amount: string
  exchangeRateUsed: string
  accountId: string
  notes: string
  taxable: boolean
  recurring: boolean
}

/**
 * Unified Transactions — additive read+CRUD layer over income_records +
 * expense_records (PF-104). Storage stays split (financeSummary/budgetVsActual
 * keep reading the original collections unchanged); this panel only presents
 * both as one list and routes ordinary adds/edits/deletes plus grouped
 * split/transfer writes through the finance API.
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
  const [auditSearch, setAuditSearch] = useState('')
  const [auditPage, setAuditPage] = useState(0)

  const [addKind, setAddKind] = useState<LedgerKind>('expense')
  const [date, setDate] = useState(todayIso())
  const [counterparty, setCounterparty] = useState('')
  const [category, setCategory] = useState('')
  const [incomeSubtype, setIncomeSubtype] = useState<EditDraft['incomeSubtype']>('other')
  const [subcategory, setSubcategory] = useState('')
  const [tags, setTags] = useState('')
  const [status, setStatus] = useState('cleared')
  const [currency, setCurrency] = useState('LKR')
  const [amount, setAmount] = useState('')
  const [exchangeRateOverride, setExchangeRateOverride] = useState('')
  const [accountId, setAccountId] = useState('')
  const [destinationAccountId, setDestinationAccountId] = useState('')
  const [splitLines, setSplitLines] = useState([
    { category: '', amount: '' },
    { category: '', amount: '' },
  ])
  const [notes, setNotes] = useState('')
  const [taxable, setTaxable] = useState(true)
  const [recurring, setRecurring] = useState(false)

  const [search, setSearch] = useState('')
  const [filterKind, setFilterKind] = useState<'all' | LedgerKind>('all')
  const [filterStatus, setFilterStatus] = useState<
    'all' | 'pending' | 'cleared' | 'reconciled'
  >('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [amountMin, setAmountMin] = useState('')
  const [amountMax, setAmountMax] = useState('')
  const [importCsv, setImportCsv] = useState<string | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [allowImportDuplicates, setAllowImportDuplicates] = useState(false)

  const accounts = payload.data.finance_accounts
  const transactions = payload.transactions

  async function downloadTransactionsCsv() {
    try {
      const response = await fetch(
        '/api/finance?scope=personal_finance&format=csv',
        { credentials: 'same-origin' },
      )
      if (!response.ok) throw new Error(`Export failed (${response.status})`)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `hermes-transactions-${todayIso()}.csv`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Export failed')
    }
  }

  async function downloadEncryptedBackup() {
    const passphrase = window.prompt(
      'Enter a passphrase (12+ characters). It will not be stored.',
    )
    if (!passphrase) return
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'download_encrypted_backup',
          passphrase,
        }),
      })
      if (!response.ok) {
        const body = (await response.json()) as { error?: string }
        throw new Error(body.error || `Backup failed (${response.status})`)
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `hermes-finance-backup-${todayIso()}.enc.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Backup failed')
    }
  }

  async function previewTransactionsCsv(file: File) {
    try {
      const csv = await file.text()
      const response = await fetch('/api/finance', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'preview_transaction_import', csv }),
      })
      const body = (await response.json()) as {
        transactionImportPreview?: ImportPreview
        error?: string
      }
      if (!response.ok || !body.transactionImportPreview) {
        throw new Error(body.error || `Import preview failed (${response.status})`)
      }
      setImportCsv(csv)
      setImportPreview(body.transactionImportPreview)
      setAllowImportDuplicates(false)
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Import preview failed')
    }
  }

  async function commitTransactionsCsv() {
    if (!importCsv || !importPreview) return
    try {
      const response = await fetch('/api/finance', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'commit_transaction_import',
          csv: importCsv,
          previewHash: importPreview.fingerprint,
          confirm: true,
          allowDuplicates: allowImportDuplicates,
        }),
      })
      const body = (await response.json()) as PersonalFinancePayload & {
        transactionImportPreview?: ImportPreview
        error?: string
      }
      if (!response.ok) {
        if (body.transactionImportPreview) {
          setImportPreview(body.transactionImportPreview)
        }
        throw new Error(body.error || `Import failed (${response.status})`)
      }
      onPayload(body)
      setImportCsv(null)
      setImportPreview(null)
      setAllowImportDuplicates(false)
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Import failed')
    }
  }

  async function submitTransaction() {
    if (addKind === 'split') {
      if (!counterparty.trim()) {
        setErr('Vendor is required')
        return
      }
      if (
        splitLines.some(
          (line) => !line.category.trim() || Number(line.amount) <= 0,
        )
      ) {
        setErr('Each split needs a category and positive amount')
        return
      }
      const data = await post(
        {
          action: 'add_split',
          payload: {
            date,
            vendor: counterparty.trim(),
            accountId: accountId || undefined,
            currency,
            notes: notes.trim() || undefined,
            tags: tags.trim() || undefined,
            status,
            splits: splitLines.map((line) => ({
              category: line.category.trim(),
              amount: Number(line.amount) || 0,
              convertedLkrAmount: Number(line.amount) || 0,
            })),
          },
        },
        'add-transaction',
      )
      if (data) {
        setCounterparty('')
        setAccountId('')
        setSplitLines([
          { category: '', amount: '' },
          { category: '', amount: '' },
        ])
        setTags('')
        setStatus('cleared')
        setNotes('')
        setDate(todayIso())
      }
      return
    }
    if (addKind === 'transfer') {
      if (!accountId || !destinationAccountId) {
        setErr('Source and destination accounts are required')
        return
      }
      const data = await post(
        {
          action: 'add_transfer',
          payload: {
            date,
            sourceAccountId: accountId,
            destinationAccountId,
            currency,
            amount: Number(amount) || 0,
            convertedLkrAmount: Number(amount) || 0,
            notes: notes.trim() || undefined,
            tags: tags.trim() || undefined,
            status,
          },
        },
        'add-transaction',
      )
      if (data) {
        setAccountId('')
        setDestinationAccountId('')
        setTags('')
        setStatus('cleared')
        setAmount('')
        setNotes('')
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
                incomeSubtype,
                originalCurrency: currency,
                originalAmount: Number(amount) || 0,
                convertedLkrAmount: Number(amount) || 0,
                exchangeRateUsed: Number(exchangeRateOverride) || undefined,
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
                exchangeRateUsed: Number(exchangeRateOverride) || undefined,
                recurring,
                ...shared,
              },
            },
            busyKey,
          )
    if (data) {
      setCounterparty('')
      setCategory('')
      setIncomeSubtype('other')
      setSubcategory('')
      setTags('')
      setStatus('cleared')
      setAmount('')
      setExchangeRateOverride('')
      setNotes('')
      setAccountId('')
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
        incomeSubtype: (stringField(txn, 'incomeSubtype') || 'other') as EditDraft['incomeSubtype'],
        subcategory: stringField(txn, 'subcategory'),
        tags: stringField(txn, 'tags'),
        status: stringField(txn, 'status') || 'cleared',
        currency: stringField(txn, 'currency') || 'LKR',
        amount: String(numberField(txn, 'amount')),
        exchangeRateUsed: String(numberField(txn, 'exchangeRateUsed') || ''),
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
                incomeSubtype: draft.incomeSubtype,
                originalCurrency: draft.currency,
                originalAmount: Number(draft.amount) || 0,
                convertedLkrAmount: Number(draft.amount) || 0,
                exchangeRateUsed: Number(draft.exchangeRateUsed) || undefined,
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
                exchangeRateUsed: Number(draft.exchangeRateUsed) || undefined,
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

  async function restoreTransaction(id: string, kind: TxnKind) {
    await post(
      { action: 'restore_record', kind, id },
      `restore-${id}`,
    )
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return transactions.filter((txn) => {
      const kind = stringField(txn, 'kind')
      const ledgerKind =
        stringField(txn, 'transactionType') === 'transfer'
          ? 'transfer'
          : stringField(txn, 'splitGroupId')
            ? 'split'
          : kind
      if (filterKind !== 'all' && ledgerKind !== filterKind) return false
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

  const deletedTransactions = useMemo(() => {
    const seen = new Set<string>()
    return payload.deletedTransactions.filter((transaction) => {
      const group =
        stringField(transaction, 'transferId') ||
        stringField(transaction, 'splitGroupId') ||
        stringField(transaction, 'id')
      if (seen.has(group)) return false
      seen.add(group)
      return true
    })
  }, [payload.deletedTransactions])

  const filteredAudit = useMemo(() => {
    const query = auditSearch.trim().toLowerCase()
    return (payload.transactionAudit ?? []).filter((entry) => {
      if (!query) return true
      return `${entry.action} ${JSON.stringify(entry.details)}`
        .toLowerCase()
        .includes(query)
    })
  }, [payload.transactionAudit, auditSearch])
  const auditPageCount = Math.max(
    1,
    Math.ceil(filteredAudit.length / AUDIT_PAGE_SIZE),
  )
  const visibleAudit = filteredAudit.slice(
    auditPage * AUDIT_PAGE_SIZE,
    (auditPage + 1) * AUDIT_PAGE_SIZE,
  )

  const totalsByCurrency = new Map<string, number>()
  let incomeCount = 0
  let expenseCount = 0
  let transferCount = 0
  const splitGroups = new Set<string>()
  for (const txn of transactions) {
    const kind = stringField(txn, 'kind')
    if (stringField(txn, 'transactionType') === 'transfer') {
      transferCount += 1
      continue
    }
    const splitGroupId = stringField(txn, 'splitGroupId')
    if (splitGroupId) {
      splitGroups.add(splitGroupId)
      continue
    }
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
        {transferCount > 0 && ` · ${transferCount / 2} transfer${transferCount === 2 ? '' : 's'}`}
        {splitGroups.size > 0 && ` · ${splitGroups.size} split${splitGroups.size === 1 ? '' : 's'}`}
        {totalsText && (
          <>
            {' '}
            · net <span className="text-[var(--theme-success)]">{totalsText}</span>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={() => void downloadTransactionsCsv()}
        className={`${buttonClass} mt-3`}
      >
        Export CSV
      </button>
      <label className={`${buttonClass} mt-3 ml-2 inline-block cursor-pointer`}>
        Import CSV
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void previewTransactionsCsv(file)
            event.currentTarget.value = ''
          }}
        />
      </label>
      <button
        type="button"
        onClick={() => void downloadEncryptedBackup()}
        className={`${buttonClass} mt-3 ml-2`}
      >
        Encrypted backup
      </button>

      {importPreview && (
        <div className="mt-3 rounded-xl border border-[var(--theme-border)] p-3 text-xs">
          <p className="font-medium text-[var(--theme-text)]">
            Import preview: {importPreview.rowCount} row(s),{' '}
            {importPreview.items.length} item(s)
          </p>
          {importPreview.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-4 text-[var(--theme-danger)]">
              {importPreview.errors.slice(0, 8).map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          {importPreview.duplicates.length > 0 && (
            <label className="mt-2 flex items-center gap-2 text-[var(--theme-warning)]">
              <input
                type="checkbox"
                checked={allowImportDuplicates}
                onChange={(event) => setAllowImportDuplicates(event.target.checked)}
              />
              Allow {importPreview.duplicates.length} possible duplicate(s)
            </label>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={
                importPreview.errors.length > 0 ||
                (importPreview.duplicates.length > 0 && !allowImportDuplicates)
              }
              onClick={() => void commitTransactionsCsv()}
              className={confirmButtonClass}
            >
              Confirm import
            </button>
            <button
              type="button"
              onClick={() => {
                setImportCsv(null)
                setImportPreview(null)
                setAllowImportDuplicates(false)
              }}
              className={buttonClass}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

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
            className={`px-3 py-1.5 text-xs font-medium ${addKind === 'transfer' ? 'bg-[color-mix(in_srgb,var(--theme-accent-secondary)_25%,transparent)] text-[var(--theme-accent-secondary)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'}`}
          >
            Transfer
          </button>
          <button
            type="button"
            onClick={() => setAddKind('split')}
            className={`px-3 py-1.5 text-xs font-medium ${addKind === 'split' ? 'bg-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] text-[var(--theme-warning)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'}`}
          >
            Split expense
          </button>
        </div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className={inputClass}
        />
        {(addKind === 'income' || addKind === 'expense') && (
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
            {addKind === 'income' && (
              <select
                value={incomeSubtype}
                onChange={(e) =>
                  setIncomeSubtype(e.target.value as EditDraft['incomeSubtype'])
                }
                className={inputClass}
                title="Structured income subtype"
              >
                <option value="salary">Salary</option>
                <option value="dividend">Dividend</option>
                <option value="interest">Interest</option>
                <option value="freelance">Freelance</option>
                <option value="other">Other</option>
              </select>
            )}
          </>
        )}
        {addKind === 'split' && (
          <input
            type="text"
            placeholder="Vendor"
            value={counterparty}
            onChange={(e) => setCounterparty(e.target.value)}
            list="pf-known-merchants"
            className={inputClass}
          />
        )}
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
        {addKind === 'split' && (
          <div className="flex flex-wrap items-center gap-2">
            {splitLines.map((line, index) => (
              <div key={index} className="flex items-center gap-1">
                <input
                  type="text"
                  placeholder={`Category ${index + 1}`}
                  value={line.category}
                  onChange={(e) =>
                    setSplitLines((prev) =>
                      prev.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, category: e.target.value }
                          : item,
                      ),
                    )
                  }
                  list="pf-known-categories"
                  className={inputClass}
                />
                <input
                  type="number"
                  placeholder="Amount"
                  value={line.amount}
                  onChange={(e) =>
                    setSplitLines((prev) =>
                      prev.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, amount: e.target.value }
                          : item,
                      ),
                    )
                  }
                  className={`${inputClass} w-28`}
                />
                {splitLines.length > 2 && (
                  <button
                    type="button"
                    onClick={() =>
                      setSplitLines((prev) =>
                        prev.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    className={dangerButtonClass}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setSplitLines((prev) => [
                  ...prev,
                  { category: '', amount: '' },
                ])
              }
              className={buttonClass}
            >
              Add category
            </button>
          </div>
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
        {addKind !== 'split' && (
          <input
            type="number"
            placeholder="Amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputClass} w-32`}
          />
        )}
        {(addKind === 'income' || addKind === 'expense') && (
          <input
            type="number"
            min="0"
            step="any"
            placeholder="FX override (optional)"
            value={exchangeRateOverride}
            onChange={(e) => setExchangeRateOverride(e.target.value)}
            title="Optional rate from this transaction currency to LKR. Leave blank to use the dated stored rate."
            className={`${inputClass} w-40`}
          />
        )}
        <select
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className={inputClass}
        >
          <option value="">{addKind === 'transfer' ? 'From account' : 'No account'}</option>
          {accounts.map((account, index) => {
            const id = stringField(account, 'id') || String(index)
            return (
              <option key={id} value={id}>
                {stringField(account, 'name')}
              </option>
            )
          })}
        </select>
        {addKind === 'transfer' && (
          <select
            value={destinationAccountId}
            onChange={(e) => setDestinationAccountId(e.target.value)}
            className={inputClass}
          >
            <option value="">To account</option>
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
        {addKind === 'income' ? (
          <label className="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
            <input
              type="checkbox"
              checked={taxable}
              onChange={(e) => setTaxable(e.target.checked)}
            />
            Taxable
          </label>
        ) : addKind === 'expense' ? (
          <label className="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
            <input
              type="checkbox"
              checked={recurring}
              onChange={(e) => setRecurring(e.target.checked)}
            />
            Recurring
          </label>
        ) : null}
        <button
          type="button"
          disabled={busy === 'add-transaction'}
          onClick={() => void submitTransaction()}
          className={buttonClass}
        >
          {busy === 'add-transaction' ? 'Saving…' : 'Add transaction'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-[var(--theme-danger)]">{err}</p>}

      {(payload.transactionAudit?.length ?? 0) > 0 && (
        <details className="mt-3 rounded-xl border border-[var(--theme-border)]/70 p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--theme-muted)]">
            Recent transaction changes ({payload.transactionAudit?.length})
          </summary>
          <input
            type="search"
            value={auditSearch}
            onChange={(event) => {
              setAuditSearch(event.target.value)
              setAuditPage(0)
            }}
            placeholder="Search changes"
            aria-label="Search transaction changes"
            className={`${inputClass} mt-2 w-full sm:max-w-sm`}
          />
          <div className="mt-2 grid gap-1.5">
            {visibleAudit.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <span className="text-[var(--theme-text)]">
                  {entry.action.replace('record_', '').replace(':', ' · ')} ·{' '}
                  {auditDetailText(entry.details)}
                </span>
                <time
                  dateTime={entry.createdAt}
                  className="text-[var(--theme-muted)]"
                >
                  {entry.createdAt
                    ? formatDateTime(entry.createdAt)
                    : 'unknown time'}
                </time>
              </div>
            ))}
            {filteredAudit.length === 0 && (
                <p className="text-xs text-[var(--theme-muted)]">
                  No changes match this search.
                </p>
            )}
          </div>
          {filteredAudit.length > AUDIT_PAGE_SIZE && (
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-[var(--theme-muted)]">
              <button
                type="button"
                className={inputClass}
                disabled={auditPage === 0}
                onClick={() => setAuditPage((page) => Math.max(0, page - 1))}
              >
                Previous
              </button>
              <span>
                Page {Math.min(auditPage + 1, auditPageCount)} of {auditPageCount}
              </span>
              <button
                type="button"
                className={inputClass}
                disabled={auditPage >= auditPageCount - 1}
                onClick={() =>
                  setAuditPage((page) => Math.min(auditPageCount - 1, page + 1))
                }
              >
                Next
              </button>
            </div>
          )}
        </details>
      )}

      {deletedTransactions.length > 0 && (
        <details className="mt-3 rounded-xl border border-[var(--theme-border)]/70 p-3">
          <summary className="cursor-pointer text-xs font-medium text-[var(--theme-muted)]">
            Recently deleted ({deletedTransactions.length})
          </summary>
          <div className="mt-2 grid gap-1.5">
            {deletedTransactions.slice(0, 8).map((transaction, index) => {
              const id = stringField(transaction, 'id') || String(index)
              const kind = (stringField(transaction, 'kind') || 'expense') as TxnKind
              return (
                <div
                  key={id}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <span>
                    {stringField(transaction, 'counterparty') || 'Transaction'}{' '}
                    · {formatMoney(numberField(transaction, 'amount'), stringField(transaction, 'currency') || 'LKR')}
                  </span>
                  <button
                    type="button"
                    className={buttonClass}
                    disabled={busy === `restore-${id}`}
                    onClick={() => void restoreTransaction(id, kind)}
                  >
                    {busy === `restore-${id}` ? 'Restoring…' : 'Restore'}
                  </button>
                </div>
              )
            })}
          </div>
        </details>
      )}

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
          onChange={(e) => setFilterKind(e.target.value as 'all' | LedgerKind)}
          className={inputClass}
        >
          <option value="all">All</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="transfer">Transfer</option>
          <option value="split">Split expense</option>
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
          const isTransfer = stringField(txn, 'transactionType') === 'transfer'
          const isSplit = Boolean(stringField(txn, 'splitGroupId'))
          const isEditing = editOpenId === id
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
                  {kind === 'income' && (
                    <select
                      value={editDrafts[id].incomeSubtype}
                      onChange={(e) =>
                        setEditDrafts((prev) => ({
                          ...prev,
                          [id]: {
                            ...prev[id],
                            incomeSubtype: e.target.value as EditDraft['incomeSubtype'],
                          },
                        }))
                      }
                      className={inputClass}
                      title="Structured income subtype"
                    >
                      <option value="salary">Salary</option>
                      <option value="dividend">Dividend</option>
                      <option value="interest">Interest</option>
                      <option value="freelance">Freelance</option>
                      <option value="other">Other</option>
                    </select>
                  )}
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
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="FX override"
                    value={editDrafts[id].exchangeRateUsed}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], exchangeRateUsed: e.target.value },
                      }))
                    }
                    title="Optional rate from this transaction currency to LKR. Leave blank to use the dated stored rate."
                    className={`${inputClass} w-36`}
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
                      className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${isTransfer ? 'bg-[color-mix(in_srgb,var(--theme-accent-secondary)_25%,transparent)] text-[var(--theme-accent-secondary)]' : isSplit ? 'bg-[color-mix(in_srgb,var(--theme-warning)_25%,transparent)] text-[var(--theme-warning)]' : kind === 'income' ? 'bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] text-[var(--theme-success)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_16%,transparent)] text-[var(--theme-muted)]'}`}
                    >
                      {isTransfer ? 'Transfer' : isSplit ? 'Split' : kind === 'income' ? 'Income' : 'Expense'}
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
                      {transactionAmountLabel(txn)}
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
                    {!isTransfer && !isSplit && (
                      <button
                        type="button"
                        onClick={() => startEdit(txn)}
                        className={buttonClass}
                      >
                        Edit
                      </button>
                    )}
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

      {confirmDeleteId && (
        <ConfirmDialog
          title="Move this transaction to trash?"
          body="You can restore it from Recently deleted."
          confirmLabel="Move to trash"
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
