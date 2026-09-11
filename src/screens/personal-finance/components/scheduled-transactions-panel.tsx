import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatLkr } from '../utils'
import {
  buttonClass,
  confirmButtonClass,
  dangerButtonClass,
  inputClass,
} from '../shared-styles'
import { numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

type Kind = 'income' | 'expense'

type Draft = {
  dueDate: string
  kind: Kind
  counterparty: string
  category: string
  amount: string
  accountId: string
  notes: string
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Plan a future income or expense (LKR). It is not counted in any total
 * until posted — "Post now" (here or in "Coming up") turns it into a real
 * record. Editable / cancellable while pending.
 */
export function ScheduledTransactionsPanel({
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

  const [kind, setKind] = useState<Kind>('expense')
  const [dueDate, setDueDate] = useState(todayIso())
  const [counterparty, setCounterparty] = useState('')
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState('')
  const [notes, setNotes] = useState('')

  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, Draft>>({})
  const [showHistory, setShowHistory] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const accounts = payload.data.finance_accounts
  const rows = [...payload.data.scheduled_transactions]
    .filter((row) => {
      const status = stringField(row, 'status') || 'pending'
      return showHistory
        ? status === 'posted' || status === 'cancelled'
        : status === 'pending' || status === 'paused'
    })
    .sort((a, b) =>
      stringField(a, 'dueDate') < stringField(b, 'dueDate') ? -1 : 1,
    )

  async function submit() {
    if (!counterparty.trim()) {
      setErr(kind === 'income' ? 'Source is required' : 'Vendor is required')
      return
    }
    if (!(Number(amount) > 0)) {
      setErr('Amount must be greater than 0')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'scheduled_transaction',
        payload: {
          dueDate,
          kind,
          counterparty: counterparty.trim(),
          category: category.trim() || (kind === 'income' ? 'Other income' : 'Other'),
          amount: Number(amount),
          accountId: accountId || undefined,
          notes: notes.trim() || undefined,
        },
      },
      'add',
    )
    if (data) {
      setCounterparty('')
      setCategory('')
      setAmount('')
      setNotes('')
      setDueDate(todayIso())
    }
  }

  function startEdit(row: Record<string, unknown>) {
    const id = stringField(row, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        dueDate: stringField(row, 'dueDate') || todayIso(),
        kind: stringField(row, 'kind') === 'income' ? 'income' : 'expense',
        counterparty: stringField(row, 'counterparty'),
        category: stringField(row, 'category'),
        amount: String(numberField(row, 'amount')),
        accountId: stringField(row, 'accountId'),
        notes: stringField(row, 'notes'),
      },
    }))
    setEditOpenId(id)
  }

  async function saveEdit(id: string) {
    const d = editDrafts[id]
    if (!d.counterparty.trim() || !(Number(d.amount) > 0)) {
      setErr('Counterparty and a positive amount are required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'scheduled_transaction',
        id,
        payload: {
          dueDate: d.dueDate,
          kind: d.kind,
          counterparty: d.counterparty.trim(),
          category: d.category.trim() || 'Other',
          amount: Number(d.amount),
          accountId: d.accountId || undefined,
          notes: d.notes.trim() || undefined,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  async function deleteScheduled(id: string) {
    const data = await post(
      {
        action: 'delete_record',
        kind: 'scheduled_transaction',
        id,
      },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  async function togglePause(id: string, status: string) {
    await post(
      {
        action: 'update_record',
        kind: 'scheduled_transaction',
        id,
        payload: { status: status === 'paused' ? 'pending' : 'paused' },
      },
      `pause-${id}`,
    )
  }

  async function postNow(id: string) {
    await post({ action: 'post_scheduled', id }, `post-${id}`)
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Scheduled transactions</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Plan a future income or expense (LKR). It isn&apos;t counted anywhere
        until you post it — from here or from “Coming up” on the Overview.
      </p>

      <button
        type="button"
        onClick={() => setShowHistory((value) => !value)}
        className={`${buttonClass} mt-3`}
      >
        {showHistory ? 'Show upcoming' : 'Show history'}
      </button>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="flex overflow-hidden rounded-xl border border-[var(--theme-border)]">
          <button
            type="button"
            onClick={() => setKind('expense')}
            className={`px-3 py-1.5 text-xs font-medium ${kind === 'expense' ? 'bg-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] text-[var(--theme-danger)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'}`}
          >
            Expense
          </button>
          <button
            type="button"
            onClick={() => setKind('income')}
            className={`px-3 py-1.5 text-xs font-medium ${kind === 'income' ? 'bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] text-[var(--theme-success)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]'}`}
          >
            Income
          </button>
        </div>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder={kind === 'income' ? 'Source' : 'Vendor'}
          value={counterparty}
          onChange={(e) => setCounterparty(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          list="pf-known-categories"
          className={inputClass}
        />
        <input
          type="number"
          placeholder="Amount (LKR)"
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
          {accounts.map((a, i) => {
            const id = stringField(a, 'id') || String(i)
            return (
              <option key={id} value={id}>
                {stringField(a, 'name')}
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
        <button
          type="button"
          disabled={busy === 'add'}
          onClick={() => void submit()}
          className={buttonClass}
        >
          {busy === 'add' ? 'Saving…' : 'Schedule'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-[var(--theme-danger)]">{err}</p>}

      <div className="mt-4 grid gap-2">
        {rows.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            Nothing scheduled yet.
          </p>
        )}
        {rows.map((row, index) => {
          const id = stringField(row, 'id') || String(index)
          const status = stringField(row, 'status') || 'pending'
          const rowKind = stringField(row, 'kind') === 'income' ? 'income' : 'expense'
          const isEditing = editOpenId === id
          return (
            <div
              key={id}
              className={`rounded-2xl border border-[var(--theme-border)]/70 p-3 ${status === 'pending' ? 'bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)]' : 'bg-[color-mix(in_srgb,var(--theme-text)_4%,transparent)] opacity-70'}`}
            >
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={editDrafts[id].dueDate}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], dueDate: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <select
                    value={editDrafts[id].kind}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], kind: e.target.value as Kind },
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Counterparty"
                    value={editDrafts[id].counterparty}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], counterparty: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="Category"
                    value={editDrafts[id].category}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], category: e.target.value },
                      }))
                    }
                    list="pf-known-categories"
                    className={inputClass}
                  />
                  <input
                    type="number"
                    placeholder="Amount"
                    value={editDrafts[id].amount}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], amount: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-28`}
                  />
                  <input
                    type="text"
                    placeholder="Notes"
                    value={editDrafts[id].notes}
                    onChange={(e) =>
                      setEditDrafts((p) => ({
                        ...p,
                        [id]: { ...p[id], notes: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
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
                  <div>
                    <span
                      className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${rowKind === 'income' ? 'bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] text-[var(--theme-success)]' : 'bg-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] text-[var(--theme-danger)]'}`}
                    >
                      {rowKind === 'income' ? 'Income' : 'Expense'}
                    </span>
                    <span className="font-medium text-[var(--theme-text)]">
                      {stringField(row, 'counterparty')}
                    </span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      · {stringField(row, 'category')} ·{' '}
                      {formatLkr(numberField(row, 'amount'), 'LKR')} · due{' '}
                      {stringField(row, 'dueDate')}
                      {status !== 'pending' && ` · ${status}`}
                    </span>
                  </div>
                  {(status === 'pending' || status === 'paused') && (
                    <div className="flex gap-2">
                      {status === 'pending' && (
                        <button
                          type="button"
                          disabled={busy === `post-${id}`}
                          onClick={() => void postNow(id)}
                          className={confirmButtonClass}
                        >
                          {busy === `post-${id}` ? 'Posting…' : 'Post now'}
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy === `pause-${id}`}
                        onClick={() => void togglePause(id, status)}
                        className={buttonClass}
                      >
                        {busy === `pause-${id}`
                          ? 'Saving…'
                          : status === 'paused'
                            ? 'Resume'
                            : 'Pause'}
                      </button>
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
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this scheduled transaction?"
          body="It will be removed from your schedule. You can't undo this."
          confirmLabel="Delete it"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteScheduled(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
