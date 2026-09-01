import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import type { PersonalFinancePayload } from '../types'

const inputClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

/**
 * WEALTH-108: purely informational estate/beneficiary notes — name,
 * relationship, and a free-text note. No legal/binding weight, no
 * percentage-split math, and zero involvement in financeSummary() (unlike
 * Loan/Property, which feed debtLkr/propertyValueLkr/netWorthLkr).
 */
export function BeneficiariesPanel({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (p: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error: err, setError: setErr } = useFinanceAction<PersonalFinancePayload>(onPayload)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [editOpenId, setEditOpenId] = useState<string | null>(null)
  const [editDrafts, setEditDrafts] = useState<Record<string, { name: string; relationship: string; note: string }>>(
    {},
  )

  const [name, setName] = useState('')
  const [relationship, setRelationship] = useState('')
  const [note, setNote] = useState('')

  async function submitBeneficiary() {
    if (!name.trim()) {
      setErr('Name is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'beneficiary',
        payload: {
          name: name.trim(),
          relationship: relationship.trim(),
          note: note.trim() || undefined,
        },
      },
      'beneficiary',
    )
    if (data) {
      setName('')
      setRelationship('')
      setNote('')
    }
  }

  async function deleteBeneficiary(id: string) {
    const data = await post({ action: 'delete_record', kind: 'beneficiary', id }, `delete-${id}`)
    if (data) setConfirmDeleteId(null)
  }

  function startEdit(beneficiary: Record<string, unknown>) {
    const id = stringField(beneficiary, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        name: stringField(beneficiary, 'name'),
        relationship: stringField(beneficiary, 'relationship'),
        note: stringField(beneficiary, 'note'),
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
      setErr('Name is required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'beneficiary',
        id,
        payload: {
          name: draft.name.trim(),
          relationship: draft.relationship.trim(),
          note: draft.note.trim() || undefined,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  const beneficiaries = payload.data.beneficiaries

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold">Beneficiaries</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        Informal notes on who you'd want to receive what — not legally binding, purely a personal reference.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Relationship"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={inputClass}
        />
        <button
          type="button"
          disabled={busy === 'beneficiary'}
          onClick={() => void submitBeneficiary()}
          className={buttonClass}
        >
          {busy === 'beneficiary' ? 'Saving…' : 'Add beneficiary'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      <div className="mt-4 grid gap-2">
        {beneficiaries.length === 0 && <p className="text-sm text-[var(--theme-muted)]">No beneficiaries added yet.</p>}
        {beneficiaries.map((beneficiary, index) => {
          const id = stringField(beneficiary, 'id') || String(index)
          const isEditing = editOpenId === id
          return (
            <div key={id} className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Name"
                    value={editDrafts[id].name}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], name: e.target.value } }))}
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="Relationship"
                    value={editDrafts[id].relationship}
                    onChange={(e) =>
                      setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], relationship: e.target.value } }))
                    }
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="Note (optional)"
                    value={editDrafts[id].note}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], note: e.target.value } }))}
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
                    <span className="font-medium text-[var(--theme-text)]">{stringField(beneficiary, 'name')}</span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      · {stringField(beneficiary, 'relationship')}
                    </span>
                    {stringField(beneficiary, 'note') && (
                      <p className="mt-1 text-xs text-[var(--theme-muted)]">{stringField(beneficiary, 'note')}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => startEdit(beneficiary)} className={buttonClass}>
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
          title="Delete this beneficiary?"
          body="This can't be undone."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteBeneficiary(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
