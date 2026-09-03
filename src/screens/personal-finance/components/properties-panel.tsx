import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { formatMoney, formatPct } from '../utils'
import { buttonClass, inputClass } from '../shared-styles'
import { numberField, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

/**
 * Property-loan linkage: purely informational (PF-1004 precedent) — does
 * not affect debtLkr/propertyValueLkr/netWorthLkr, each already counted
 * once independently regardless of linkage.
 */
function LinkedLoanControl({
  property,
  payload,
  onPayload,
  editingId,
  setEditingId,
}: {
  property: Record<string, unknown>
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
  editingId: string | null
  setEditingId: (id: string | null) => void
}) {
  const id = stringField(property, 'id')
  const linkedLoanId = stringField(property, 'linkedLoanId')
  const loans = payload.data.loans
  const linkedLoan = loans.find((l) => stringField(l, 'id') === linkedLoanId)

  async function setLinkedLoan(nextId: string) {
    setEditingId(null)
    await fetch('/api/finance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'update_record',
        kind: 'property',
        id,
        payload: { linkedLoanId: nextId || null },
      }),
    })
      .then((r) => r.json())
      .then((data: PersonalFinancePayload) => {
        if (data.ok) onPayload(data)
      })
      .catch(() => {})
  }

  if (linkedLoanId && editingId !== id) {
    return (
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        🔗 Secured by{' '}
        {linkedLoan ? stringField(linkedLoan, 'lender') : '(removed loan)'}{' '}
        <button
          type="button"
          onClick={() => setEditingId(id)}
          className="underline hover:text-[var(--theme-text)]"
        >
          Change
        </button>
      </p>
    )
  }

  return (
    <select
      value={linkedLoanId}
      onChange={(e) => void setLinkedLoan(e.target.value)}
      className="mt-1 rounded-lg border border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] px-2 py-0.5 text-xs text-[var(--theme-text)] outline-none"
    >
      <option value="">— No linked loan —</option>
      {loans.map((loan, index) => {
        const loanId = stringField(loan, 'id') || String(index)
        return (
          <option key={loanId} value={loanId}>
            {stringField(loan, 'lender')}
          </option>
        )
      })}
    </select>
  )
}

/**
 * Phase 40 (WEALTH-102/103): dedicated property tracking — currentValue is
 * manually updated (no valuation API), like Loan.currentBalance. Feeds
 * financeSummary()'s netWorthLkr as an asset.
 */
export function PropertiesPanel({
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
  const [linkEditingId, setLinkEditingId] = useState<string | null>(null)
  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<
    Record<
      string,
      {
        description: string
        propertyType: string
        purchasePrice: string
        currentValue: string
        currency: string
        purchaseDate: string
        notes: string
      }
    >
  >({})

  const [description, setDescription] = useState('')
  const [propertyType, setPropertyType] = useState('residential')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [currentValue, setCurrentValue] = useState('')
  const [currency, setCurrency] = useState('LKR')
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [notes, setNotes] = useState('')

  async function submitProperty() {
    if (!description.trim()) {
      setErr('Description is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'property',
        payload: {
          description: description.trim(),
          propertyType,
          purchasePrice: Number(purchasePrice) || 0,
          currentValue: Number(currentValue) || Number(purchasePrice) || 0,
          currency,
          purchaseDate,
          notes: notes.trim() || undefined,
        },
      },
      'property',
    )
    if (data) {
      setDescription('')
      setPurchasePrice('')
      setCurrentValue('')
      setNotes('')
    }
  }

  async function deleteProperty(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'property', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  function startEdit(property: Record<string, unknown>) {
    const id = stringField(property, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        description: stringField(property, 'description'),
        propertyType: stringField(property, 'propertyType') || 'residential',
        purchasePrice: String(numberField(property, 'purchasePrice')),
        currentValue: String(numberField(property, 'currentValue')),
        currency: stringField(property, 'currency') || 'LKR',
        purchaseDate: stringField(property, 'purchaseDate'),
        notes: stringField(property, 'notes'),
      },
    }))
    setEditOpenId(id)
  }

  function cancelEdit() {
    setEditOpenId(null)
  }

  async function saveEdit(id: string) {
    const draft = editDrafts[id]
    if (!draft.description.trim()) {
      setErr('Description is required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'property',
        id,
        payload: {
          description: draft.description.trim(),
          propertyType: draft.propertyType,
          purchasePrice: Number(draft.purchasePrice) || 0,
          currentValue: Number(draft.currentValue) || 0,
          currency: draft.currency,
          purchaseDate: draft.purchaseDate,
          notes: draft.notes.trim() || undefined,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  const properties = payload.data.properties

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Properties</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Track what you own — current value is manually updated, like a fixed
        deposit's balance.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
        <select
          value={propertyType}
          onChange={(e) => setPropertyType(e.target.value)}
          className={inputClass}
        >
          <option value="residential">Residential</option>
          <option value="land">Land</option>
          <option value="commercial">Commercial</option>
          <option value="other">Other</option>
        </select>
        <input
          type="number"
          placeholder="Purchase price"
          value={purchasePrice}
          onChange={(e) => setPurchasePrice(e.target.value)}
          className={`${inputClass} w-32`}
        />
        <input
          type="number"
          placeholder="Current value"
          value={currentValue}
          onChange={(e) => setCurrentValue(e.target.value)}
          className={`${inputClass} w-32`}
        />
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className={inputClass}
        >
          <option value="LKR">LKR</option>
          <option value="USD">USD</option>
        </select>
        <input
          type="date"
          value={purchaseDate}
          onChange={(e) => setPurchaseDate(e.target.value)}
          className={inputClass}
          title="Purchase date"
        />
        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
        />
        <button
          type="button"
          disabled={busy === 'property'}
          onClick={() => void submitProperty()}
          className={buttonClass}
        >
          {busy === 'property' ? 'Saving…' : 'Add property'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      <div className="mt-4 grid gap-2">
        {properties.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            No properties added yet.
          </p>
        )}
        {properties.map((property, index) => {
          const id = stringField(property, 'id') || String(index)
          const propCurrency = stringField(property, 'currency') || 'LKR'
          const purchase = numberField(property, 'purchasePrice')
          const current = numberField(property, 'currentValue')
          const gainLoss = current - purchase
          const gainLossPct = purchase > 0 ? (gainLoss / purchase) * 100 : 0
          const isEditing = editOpenId === id
          return (
            <div
              key={id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] p-3"
            >
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Description"
                    value={editDrafts[id].description}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], description: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <select
                    value={editDrafts[id].propertyType}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], propertyType: e.target.value },
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="residential">Residential</option>
                    <option value="land">Land</option>
                    <option value="commercial">Commercial</option>
                    <option value="other">Other</option>
                  </select>
                  <input
                    type="number"
                    placeholder="Purchase price"
                    value={editDrafts[id].purchasePrice}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], purchasePrice: e.target.value },
                      }))
                    }
                    className={`${inputClass} w-32`}
                  />
                  <input
                    type="number"
                    placeholder="Current value"
                    value={editDrafts[id].currentValue}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], currentValue: e.target.value },
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
                    <option value="LKR">LKR</option>
                    <option value="USD">USD</option>
                  </select>
                  <input
                    type="date"
                    value={editDrafts[id].purchaseDate}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], purchaseDate: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="Notes (optional)"
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
                    onClick={() => void saveEdit(id)}
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
                    <span className="font-medium text-[var(--theme-text)]">
                      {stringField(property, 'description')}
                    </span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      · {stringField(property, 'propertyType')} · current{' '}
                      {formatMoney(current, propCurrency)} (bought{' '}
                      {formatMoney(purchase, propCurrency)})
                    </span>
                    {purchase > 0 && (
                      <span
                        className={`ml-2 text-xs font-medium ${gainLoss >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                      >
                        {gainLoss >= 0 ? '+' : ''}
                        {formatMoney(gainLoss, propCurrency)} (
                        {gainLoss >= 0 ? '+' : ''}
                        {formatPct(gainLossPct)})
                      </span>
                    )}
                    {stringField(property, 'notes') && (
                      <p className="mt-1 text-xs text-[var(--theme-muted)]">
                        {stringField(property, 'notes')}
                      </p>
                    )}
                    <LinkedLoanControl
                      property={property}
                      payload={payload}
                      onPayload={onPayload}
                      editingId={linkEditingId}
                      setEditingId={setLinkEditingId}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(property)}
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
          title="Delete this property?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteProperty(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
