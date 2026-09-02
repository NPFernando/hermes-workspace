import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { computeAccountLedgerBalance, formatMoney } from '../utils'
import type { ReconcileTransaction } from '../utils'
import type { PersonalFinancePayload } from '../types'

const inputClass =
  'min-w-[140px] rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

const ACCOUNT_TYPES = [
  { value: 'bank', label: 'Bank' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'crypto_wallet', label: 'Crypto wallet' },
  { value: 'broker', label: 'Broker' },
  { value: 'foreign_currency', label: 'Foreign currency' },
  { value: 'loan', label: 'Loan' },
  { value: 'other', label: 'Other' },
] as const

function accountTypeLabel(type: string): string {
  return ACCOUNT_TYPES.find((t) => t.value === type)?.label ?? type
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function optionalNumberField(row: Record<string, unknown>, key: string): number | undefined {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

type EditDraft = {
  name: string
  type: string
  currency: string
  balance: string
  openingBalance: string
  openingBalanceDate: string
  maskedIdentifier: string
  platform: string
}

/**
 * Accounts — dedicated panel (PF-100/101/102/103), replacing the generic
 * DataTable treatment. `balance` stays a manually-maintained current figure,
 * edited directly here — it is never auto-recalculated. AI-600 (Phase 28)
 * adds an informational per-account reconciliation badge below, comparing
 * this declared balance against what the account's own tagged transactions
 * say it should be (starting from openingBalance) — see
 * computeAccountLedgerBalance in utils.ts.
 */
export function AccountsPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error: err, setError: setErr } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, EditDraft>>({})

  const [name, setName] = useState('')
  const [type, setType] = useState<string>('bank')
  const [currency, setCurrency] = useState('LKR')
  const [balance, setBalance] = useState('')
  const [openingBalance, setOpeningBalance] = useState('')
  const [openingBalanceDate, setOpeningBalanceDate] = useState('')
  const [maskedIdentifier, setMaskedIdentifier] = useState('')
  const [platform, setPlatform] = useState('')

  async function submitAccount() {
    if (!name.trim()) {
      setErr('Account name is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'account',
        payload: {
          name: name.trim(),
          type,
          currency,
          balance: Number(balance) || 0,
          openingBalance: openingBalance.trim() ? Number(openingBalance) : undefined,
          openingBalanceDate: openingBalanceDate || undefined,
          maskedIdentifier: maskedIdentifier.trim() || undefined,
          platform: platform.trim() || undefined,
        },
      },
      'account',
    )
    if (data) {
      setName('')
      setBalance('')
      setOpeningBalance('')
      setOpeningBalanceDate('')
      setMaskedIdentifier('')
      setPlatform('')
    }
  }

  function startEdit(account: Record<string, unknown>) {
    const id = stringField(account, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        name: stringField(account, 'name'),
        type: stringField(account, 'type') || 'other',
        currency: stringField(account, 'currency') || 'LKR',
        balance: String(numberField(account, 'balance')),
        openingBalance: optionalNumberField(account, 'openingBalance')?.toString() ?? '',
        openingBalanceDate: stringField(account, 'openingBalanceDate'),
        maskedIdentifier: stringField(account, 'maskedIdentifier'),
        platform: stringField(account, 'platform'),
      },
    }))
    setEditOpenId(id)
  }

  function cancelEdit() {
    setEditOpenId(null)
  }

  async function saveEdit(id: string) {
    const draft = editDrafts[id]
    if (!draft.name.trim()) {
      setErr('Account name is required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'account',
        id,
        payload: {
          name: draft.name.trim(),
          type: draft.type,
          currency: draft.currency,
          balance: Number(draft.balance) || 0,
          openingBalance: draft.openingBalance.trim() ? Number(draft.openingBalance) : undefined,
          openingBalanceDate: draft.openingBalanceDate || undefined,
          maskedIdentifier: draft.maskedIdentifier.trim() || undefined,
          platform: draft.platform.trim() || undefined,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  async function deleteAccount(id: string) {
    const data = await post({ action: 'delete_record', kind: 'account', id }, `delete-${id}`)
    if (data) setConfirmDeleteId(null)
  }

  const accounts = payload.data.finance_accounts

  const ledgerTransactions: Array<ReconcileTransaction> = useMemo(
    () => [
      ...payload.data.income_records.map((r) => ({
        accountId: stringField(r, 'accountId') || undefined,
        currency: stringField(r, 'originalCurrency') || 'LKR',
        amount: numberField(r, 'originalAmount'),
        kind: 'income' as const,
      })),
      ...payload.data.expense_records.map((r) => ({
        accountId: stringField(r, 'accountId') || undefined,
        currency: stringField(r, 'currency') || 'LKR',
        amount: numberField(r, 'amount'),
        kind: 'expense' as const,
      })),
    ],
    [payload.data.income_records, payload.data.expense_records],
  )

  const totalsByCurrency = new Map<string, number>()
  for (const account of accounts) {
    const accountCurrency = stringField(account, 'currency') || 'LKR'
    totalsByCurrency.set(accountCurrency, (totalsByCurrency.get(accountCurrency) ?? 0) + numberField(account, 'balance'))
  }
  const totalsText = Array.from(totalsByCurrency.entries())
    .map(([entryCurrency, amount]) => formatMoney(amount, entryCurrency))
    .join(' · ')

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Accounts</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Bank, cash, cards, wallets, brokers, and loans — everything else in this app ties back to these.
      </p>
      {totalsText && (
        <p className="mt-2 text-sm font-medium text-[var(--theme-text)]">
          Total balance: <span className="text-emerald-300">{totalsText}</span>
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Account name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <select value={type} onChange={(e) => setType(e.target.value)} className={inputClass}>
          {ACCOUNT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={inputClass}>
          <option value="LKR">LKR</option>
          <option value="USD">USD</option>
          <option value="AUD">AUD</option>
        </select>
        <input
          type="number"
          placeholder="Current balance"
          value={balance}
          onChange={(e) => setBalance(e.target.value)}
          className={`${inputClass} w-32`}
        />
        <input
          type="number"
          placeholder="Opening balance (optional)"
          value={openingBalance}
          onChange={(e) => setOpeningBalance(e.target.value)}
          className={`${inputClass} w-44`}
        />
        {openingBalance.trim() && (
          <input
            type="date"
            value={openingBalanceDate}
            onChange={(e) => setOpeningBalanceDate(e.target.value)}
            className={inputClass}
            title="Opening balance date"
          />
        )}
        <input
          type="text"
          placeholder="Masked identifier (optional)"
          value={maskedIdentifier}
          onChange={(e) => setMaskedIdentifier(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Institution / platform (optional)"
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className={inputClass}
        />
        <button type="button" disabled={busy === 'account'} onClick={() => void submitAccount()} className={buttonClass}>
          {busy === 'account' ? 'Saving…' : 'Add account'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      <div className="mt-4 grid gap-2">
        {accounts.length === 0 && <p className="text-sm text-[var(--theme-muted)]">No accounts added yet.</p>}
        {accounts.map((account, index) => {
          const id = stringField(account, 'id') || String(index)
          const isEditing = editOpenId === id
          const accountCurrency = stringField(account, 'currency') || 'LKR'
          const balanceValue = numberField(account, 'balance')
          const openingBalanceValue = optionalNumberField(account, 'openingBalance')
          const openingBalanceDateValue = stringField(account, 'openingBalanceDate')
          const maskedIdentifierValue = stringField(account, 'maskedIdentifier')
          const platformValue = stringField(account, 'platform')
          const ledgerBalance = computeAccountLedgerBalance(
            { id, currency: accountCurrency, openingBalance: openingBalanceValue },
            ledgerTransactions,
          )
          const reconciliationDiff = ledgerBalance === null ? null : balanceValue - ledgerBalance

          return (
            <div key={id} className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Account name"
                    value={editDrafts[id].name}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], name: e.target.value } }))}
                    className={inputClass}
                  />
                  <select
                    value={editDrafts[id].type}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], type: e.target.value } }))}
                    className={inputClass}
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={editDrafts[id].currency}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], currency: e.target.value } }))}
                    className={inputClass}
                  >
                    <option value="LKR">LKR</option>
                    <option value="USD">USD</option>
                    <option value="AUD">AUD</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Current balance"
                    value={editDrafts[id].balance}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], balance: e.target.value } }))}
                    className={`${inputClass} w-32`}
                  />
                  <input
                    type="number"
                    placeholder="Opening balance"
                    value={editDrafts[id].openingBalance}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], openingBalance: e.target.value } }))
                    }
                    className={`${inputClass} w-40`}
                  />
                  <input
                    type="date"
                    value={editDrafts[id].openingBalanceDate}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], openingBalanceDate: e.target.value } }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="Masked identifier"
                    value={editDrafts[id].maskedIdentifier}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], maskedIdentifier: e.target.value } }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="Institution / platform"
                    value={editDrafts[id].platform}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], platform: e.target.value } }))}
                    className={inputClass}
                  />
                  <button
                    type="button"
                    disabled={busy === `edit-${id}`}
                    onClick={() => void saveEdit(id)}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {busy === `edit-${id}` ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={cancelEdit} className={buttonClass}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-[var(--theme-text)]">{stringField(account, 'name')}</span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      · {accountTypeLabel(stringField(account, 'type'))} · {formatMoney(balanceValue, accountCurrency)}
                      {maskedIdentifierValue && ` · ${maskedIdentifierValue}`}
                      {platformValue && ` · ${platformValue}`}
                    </span>
                    {openingBalanceValue !== undefined && (
                      <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
                        Opened at {formatMoney(openingBalanceValue, accountCurrency)}
                        {openingBalanceDateValue && ` on ${openingBalanceDateValue}`}
                      </p>
                    )}
                    {reconciliationDiff === null ? (
                      <p className="mt-1 text-[10px] text-[var(--theme-muted)]">
                        Set an opening balance to enable reconciliation.
                      </p>
                    ) : Math.abs(reconciliationDiff) < 1 ? (
                      <p className="mt-1 text-[10px] text-emerald-300">✓ Reconciled with recorded transactions</p>
                    ) : (
                      <p className="mt-1 text-[10px] text-amber-300">
                        ⚠ Off by {formatMoney(Math.abs(reconciliationDiff), accountCurrency)} from recorded transactions
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => startEdit(account)} className={buttonClass}>
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
          title="Delete this account?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteAccount(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
