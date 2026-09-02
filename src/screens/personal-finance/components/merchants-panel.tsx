import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { buttonClass, inputClass } from '../shared-styles'
import { stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

type EditDraft = {
  name: string
  defaultCategory: string
  notes: string
}

/**
 * Merchants — real entity (PF-111) alongside the free-text ExpenseRecord.vendor
 * field, same additive pattern as Category/Subcategory: a management
 * catalogue, not a foreign key. `defaultCategory` (also free text) powers a
 * UI convenience in TransactionsPanel (auto-fill category on a recognized
 * vendor), never a hard link — see categories-panel.tsx for the identical
 * pattern this mirrors.
 */
export function MerchantsPanel({
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

  const [name, setName] = useState('')
  const [defaultCategory, setDefaultCategory] = useState('')
  const [notes, setNotes] = useState('')

  const merchants = payload.data.merchants

  async function submitMerchant(prefill?: { name: string }) {
    const finalName = (prefill?.name ?? name).trim()
    if (!finalName) {
      setErr('Merchant name is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'merchant',
        payload: {
          name: finalName,
          defaultCategory: prefill
            ? undefined
            : defaultCategory.trim() || undefined,
          notes: prefill ? undefined : notes.trim() || undefined,
        },
      },
      'merchant',
    )
    if (data) {
      setName('')
      setDefaultCategory('')
      setNotes('')
    }
  }

  function startEdit(merchant: Record<string, unknown>) {
    const id = stringField(merchant, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        name: stringField(merchant, 'name'),
        defaultCategory: stringField(merchant, 'defaultCategory'),
        notes: stringField(merchant, 'notes'),
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
      setErr('Merchant name is required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'merchant',
        id,
        payload: {
          name: draft.name.trim(),
          defaultCategory: draft.defaultCategory.trim() || undefined,
          notes: draft.notes.trim() || undefined,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  async function deleteMerchant(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'merchant', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const exp of payload.data.expense_records) {
      const v = stringField(exp, 'vendor')
      if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
    }
    return counts
  }, [payload.data.expense_records])

  const unmanaged = useMemo(() => {
    const known = new Set(merchants.map((m) => stringField(m, 'name')))
    const found = new Set<string>()
    for (const exp of payload.data.expense_records) {
      const v = stringField(exp, 'vendor')
      if (v && !known.has(v)) found.add(v)
    }
    return Array.from(found)
  }, [merchants, payload.data.expense_records])

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <datalist id="pf-known-merchants">
        {merchants.map((m, index) => (
          <option
            key={stringField(m, 'id') || String(index)}
            value={stringField(m, 'name')}
          />
        ))}
      </datalist>

      <h2 className="text-lg font-semibold">Merchants</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        A managed list of vendors — set a default category so entering a
        recognized vendor in Transactions can suggest it. Expense matching still
        uses the free-text vendor name; renaming here does not touch past
        records.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Merchant name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Default category (optional)"
          value={defaultCategory}
          onChange={(e) => setDefaultCategory(e.target.value)}
          list="pf-known-categories"
          className={inputClass}
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
          disabled={busy === 'merchant'}
          onClick={() => void submitMerchant()}
          className={buttonClass}
        >
          {busy === 'merchant' ? 'Saving…' : 'Add merchant'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      <div className="mt-4 grid gap-2">
        {merchants.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            No merchants added yet.
          </p>
        )}
        {merchants.map((merchant, index) => {
          const id = stringField(merchant, 'id') || String(index)
          const isEditing = editOpenId === id
          const merchantName = stringField(merchant, 'name')
          const merchantDefaultCategory = stringField(
            merchant,
            'defaultCategory',
          )
          const count = usageCounts.get(merchantName) ?? 0

          return (
            <div
              key={id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
            >
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Merchant name"
                    value={editDrafts[id].name}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], name: e.target.value },
                      }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="Default category"
                    value={editDrafts[id].defaultCategory}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({
                        ...prev,
                        [id]: { ...prev[id], defaultCategory: e.target.value },
                      }))
                    }
                    list="pf-known-categories"
                    className={inputClass}
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
                      {merchantName}
                    </span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      {merchantDefaultCategory &&
                        `· default: ${merchantDefaultCategory} `}
                      · used {count} time
                      {count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(merchant)}
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

      {unmanaged.length > 0 && (
        <div className="mt-4 border-t border-[var(--theme-border)]/50 pt-3">
          <p className="text-xs font-medium text-[var(--theme-muted)]">
            In use, not yet a merchant
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {unmanaged.map((vendorName) => (
              <button
                key={vendorName}
                type="button"
                disabled={busy === 'merchant'}
                onClick={() => void submitMerchant({ name: vendorName })}
                className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1 text-xs text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40"
              >
                + {vendorName}
              </button>
            ))}
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this merchant?"
          body="Existing records keep their vendor text — this only removes it from the managed list."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteMerchant(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
