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
import { boolField, numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

type Draft = {
  taxYear: string
  incomeType: string
  amount: string
  currency: string
  convertedLkrAmount: string
  exchangeRateSource: string
  deductionCategory: string
  taxPaid: string
  taxDue: string
  supportingDocument: string
  requiresConfirmation: boolean
  notes: string
}

function emptyDraft(): Draft {
  return {
    taxYear: String(new Date().getFullYear()),
    incomeType: '',
    amount: '',
    currency: 'LKR',
    convertedLkrAmount: '',
    exchangeRateSource: 'manual',
    deductionCategory: '',
    taxPaid: '',
    taxDue: '',
    supportingDocument: '',
    requiresConfirmation: true,
    notes: '',
  }
}

function toPayload(d: Draft) {
  return {
    taxYear: d.taxYear.trim() || String(new Date().getFullYear()),
    incomeType: d.incomeType.trim() || 'Other income',
    amount: Number(d.amount) || 0,
    currency: d.currency,
    convertedLkrAmount:
      Number(d.convertedLkrAmount) || Number(d.amount) || 0,
    exchangeRateSource: d.exchangeRateSource.trim() || 'manual',
    deductionCategory: d.deductionCategory.trim() || undefined,
    taxPaid: Number(d.taxPaid) || 0,
    taxDue: Number(d.taxDue) || 0,
    supportingDocument: d.supportingDocument.trim() || undefined,
    requiresConfirmation: d.requiresConfirmation,
    notes: d.notes.trim() || undefined,
  }
}

function DraftForm({
  draft,
  onChange,
}: {
  draft: Draft
  onChange: (d: Draft) => void
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        placeholder="Tax year"
        value={draft.taxYear}
        onChange={(e) => set({ taxYear: e.target.value })}
        className={`${inputClass} w-24`}
      />
      <input
        type="text"
        placeholder="Income type"
        value={draft.incomeType}
        onChange={(e) => set({ incomeType: e.target.value })}
        className={inputClass}
      />
      <input
        type="number"
        placeholder="Amount"
        value={draft.amount}
        onChange={(e) => set({ amount: e.target.value })}
        className={`${inputClass} w-28`}
      />
      <select
        value={draft.currency}
        onChange={(e) => set({ currency: e.target.value })}
        className={inputClass}
      >
        {['LKR', 'USD', 'AUD'].map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <input
        type="number"
        placeholder="Converted LKR"
        value={draft.convertedLkrAmount}
        onChange={(e) => set({ convertedLkrAmount: e.target.value })}
        className={`${inputClass} w-32`}
      />
      <input
        type="text"
        placeholder="Rate source"
        value={draft.exchangeRateSource}
        onChange={(e) => set({ exchangeRateSource: e.target.value })}
        className={`${inputClass} w-28`}
      />
      <input
        type="number"
        placeholder="Tax paid"
        value={draft.taxPaid}
        onChange={(e) => set({ taxPaid: e.target.value })}
        className={`${inputClass} w-24`}
      />
      <input
        type="number"
        placeholder="Tax due"
        value={draft.taxDue}
        onChange={(e) => set({ taxDue: e.target.value })}
        className={`${inputClass} w-24`}
      />
      <input
        type="text"
        placeholder="Deduction category"
        value={draft.deductionCategory}
        onChange={(e) => set({ deductionCategory: e.target.value })}
        className={inputClass}
      />
      <input
        type="text"
        placeholder="Supporting document"
        value={draft.supportingDocument}
        onChange={(e) => set({ supportingDocument: e.target.value })}
        className={inputClass}
      />
      <input
        type="text"
        placeholder="Notes"
        value={draft.notes}
        onChange={(e) => set({ notes: e.target.value })}
        className={inputClass}
      />
      <label className="flex items-center gap-1.5 text-xs text-[var(--theme-muted)]">
        <input
          type="checkbox"
          checked={draft.requiresConfirmation}
          onChange={(e) => set({ requiresConfirmation: e.target.checked })}
        />
        Needs confirmation
      </label>
    </div>
  )
}

/**
 * Purpose-built editor for tax records — replaces the generic DataTable
 * (review U4). Figures are estimates; the "needs confirmation" flag stays.
 */
export function TaxRecordsPanel({
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

  const [addDraft, setAddDraft] = useState<Draft>(emptyDraft())
  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, Draft>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const records = [...payload.data.tax_records].sort((a, b) =>
    stringField(a, 'taxYear') < stringField(b, 'taxYear') ? 1 : -1,
  )

  async function add() {
    if (!addDraft.incomeType.trim()) {
      setErr('Income type is required')
      return
    }
    const data = await post(
      { action: 'add_record', kind: 'tax', payload: toPayload(addDraft) },
      'add',
    )
    if (data) setAddDraft(emptyDraft())
  }

  function startEdit(r: Record<string, unknown>) {
    const id = stringField(r, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        taxYear: stringField(r, 'taxYear'),
        incomeType: stringField(r, 'incomeType'),
        amount: String(numberField(r, 'amount')),
        currency: stringField(r, 'currency') || 'LKR',
        convertedLkrAmount: String(numberField(r, 'convertedLkrAmount')),
        exchangeRateSource: stringField(r, 'exchangeRateSource') || 'manual',
        deductionCategory: stringField(r, 'deductionCategory'),
        taxPaid: String(numberField(r, 'taxPaid')),
        taxDue: String(numberField(r, 'taxDue')),
        supportingDocument: stringField(r, 'supportingDocument'),
        requiresConfirmation: boolField(r, 'requiresConfirmation'),
        notes: stringField(r, 'notes'),
      },
    }))
    setEditOpenId(id)
  }

  async function saveEdit(id: string) {
    const d = editDrafts[id]
    if (!d.incomeType.trim()) {
      setErr('Income type is required')
      return
    }
    const data = await post(
      { action: 'update_record', kind: 'tax', id, payload: toPayload(d) },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  async function del(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'tax', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Tax records</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Estimates — confirm against official sources before filing.
      </p>

      <div className="mt-3">
        <DraftForm draft={addDraft} onChange={setAddDraft} />
        <button
          type="button"
          disabled={busy === 'add'}
          onClick={() => void add()}
          className={`${buttonClass} mt-2`}
        >
          {busy === 'add' ? 'Saving…' : 'Add tax record'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-[var(--theme-danger)]">{err}</p>}

      <div className="mt-4 grid gap-2">
        {records.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            No tax records yet.
          </p>
        )}
        {records.map((r, index) => {
          const id = stringField(r, 'id') || String(index)
          const isEditing = editOpenId === id
          return (
            <div
              key={id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              {isEditing ? (
                <div className="grid gap-2">
                  <DraftForm
                    draft={editDrafts[id]}
                    onChange={(d) =>
                      setEditDrafts((p) => ({ ...p, [id]: d }))
                    }
                  />
                  <div className="flex gap-2">
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
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-[var(--theme-text)]">
                    <span className="font-medium">
                      {stringField(r, 'taxYear')}
                    </span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      · {stringField(r, 'incomeType')} ·{' '}
                      {formatLkr(numberField(r, 'convertedLkrAmount'), 'LKR')} ·
                      paid {formatLkr(numberField(r, 'taxPaid'), 'LKR')} / due{' '}
                      {formatLkr(numberField(r, 'taxDue'), 'LKR')}
                      {boolField(r, 'requiresConfirmation') && ' · unconfirmed'}
                    </span>
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
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

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this tax record?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void del(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
