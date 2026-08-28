import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import type { PersonalFinancePayload } from '../types'

const inputClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
const buttonClass =
  'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

const CATEGORY_KINDS = [
  { value: 'both', label: 'Both' },
  { value: 'income', label: 'Income' },
  { value: 'expense', label: 'Expense' },
] as const

function kindLabel(kind: string): string {
  return CATEGORY_KINDS.find((k) => k.value === kind)?.label ?? kind
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

type EditDraft = {
  name: string
  kind: string
  color: string
  notes: string
}

/**
 * Categories — real entity (PF-109) alongside the free-text category/incomeType
 * strings on expense/income/budget records, which remain the join key for
 * budgetVsActual (see finance-store.ts getBudgetVsActual). This panel manages
 * the catalogue and surfaces a datalist for those free-text inputs elsewhere;
 * it does not add a categoryId foreign key or touch the existing join.
 */
export function CategoriesPanel({
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
  const [kind, setKind] = useState<string>('both')
  const [color, setColor] = useState('')
  const [notes, setNotes] = useState('')

  const categories = payload.data.categories

  async function submitCategory(prefill?: { name: string; kind: string }) {
    const finalName = (prefill?.name ?? name).trim()
    if (!finalName) {
      setErr('Category name is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'category',
        payload: {
          name: finalName,
          kind: prefill?.kind ?? kind,
          color: color.trim() || undefined,
          notes: notes.trim() || undefined,
        },
      },
      'category',
    )
    if (data) {
      setName('')
      setColor('')
      setNotes('')
    }
  }

  function startEdit(category: Record<string, unknown>) {
    const id = stringField(category, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        name: stringField(category, 'name'),
        kind: stringField(category, 'kind') || 'both',
        color: stringField(category, 'color'),
        notes: stringField(category, 'notes'),
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
      setErr('Category name is required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'category',
        id,
        payload: {
          name: draft.name.trim(),
          kind: draft.kind,
          color: draft.color.trim() || undefined,
          notes: draft.notes.trim() || undefined,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  async function deleteCategory(id: string) {
    const data = await post({ action: 'delete_record', kind: 'category', id }, `delete-${id}`)
    if (data) setConfirmDeleteId(null)
  }

  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const exp of payload.data.expense_records) {
      const c = stringField(exp, 'category')
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    for (const inc of payload.data.income_records) {
      const c = stringField(inc, 'incomeType')
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    for (const b of payload.data.budget_categories) {
      const c = stringField(b, 'category')
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return counts
  }, [payload.data.expense_records, payload.data.income_records, payload.data.budget_categories])

  const unmanaged = useMemo(() => {
    const known = new Set(categories.map((c) => stringField(c, 'name')))
    const found = new Map<string, string>()
    for (const exp of payload.data.expense_records) {
      const c = stringField(exp, 'category')
      if (c && !known.has(c) && !found.has(c)) found.set(c, 'expense')
    }
    for (const inc of payload.data.income_records) {
      const c = stringField(inc, 'incomeType')
      if (c && !known.has(c) && !found.has(c)) found.set(c, 'income')
    }
    for (const b of payload.data.budget_categories) {
      const c = stringField(b, 'category')
      if (c && !known.has(c) && !found.has(c)) found.set(c, 'expense')
    }
    return Array.from(found.entries())
  }, [categories, payload.data.expense_records, payload.data.income_records, payload.data.budget_categories])

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <datalist id="pf-known-categories">
        {categories.map((c, index) => (
          <option key={stringField(c, 'id') || String(index)} value={stringField(c, 'name')} />
        ))}
      </datalist>

      <h2 className="text-lg font-semibold">Categories</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        A managed list of income/expense categories — expense and budget matching still uses the free-text name you
        see here, so renaming a category here does not retroactively update past records.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Category name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
          {CATEGORY_KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="Color (optional, e.g. #22c55e)"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className={inputClass}
        />
        <input
          type="text"
          placeholder="Notes (optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
        />
        <button type="button" disabled={busy === 'category'} onClick={() => void submitCategory()} className={buttonClass}>
          {busy === 'category' ? 'Saving…' : 'Add category'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      <div className="mt-4 grid gap-2">
        {categories.length === 0 && <p className="text-sm text-[var(--theme-muted)]">No categories added yet.</p>}
        {categories.map((category, index) => {
          const id = stringField(category, 'id') || String(index)
          const isEditing = editOpenId === id
          const categoryName = stringField(category, 'name')
          const categoryKind = stringField(category, 'kind') || 'both'
          const count = usageCounts.get(categoryName) ?? 0

          return (
            <div key={id} className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3">
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Category name"
                    value={editDrafts[id].name}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], name: e.target.value } }))}
                    className={inputClass}
                  />
                  <select
                    value={editDrafts[id].kind}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], kind: e.target.value } }))}
                    className={inputClass}
                  >
                    {CATEGORY_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="Color"
                    value={editDrafts[id].color}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], color: e.target.value } }))}
                    className={inputClass}
                  />
                  <input
                    type="text"
                    placeholder="Notes"
                    value={editDrafts[id].notes}
                    onChange={(e) => setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], notes: e.target.value } }))}
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
                    {stringField(category, 'color') && (
                      <span
                        className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                        style={{ backgroundColor: stringField(category, 'color') }}
                      />
                    )}
                    <span className="font-medium text-[var(--theme-text)]">{categoryName}</span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      · {kindLabel(categoryKind)} · used {count} time{count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => startEdit(category)} className={buttonClass}>
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
          <p className="text-xs font-medium text-[var(--theme-muted)]">In use, not yet a category</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {unmanaged.map(([catName, guessedKind]) => (
              <button
                key={catName}
                type="button"
                disabled={busy === 'category'}
                onClick={() => void submitCategory({ name: catName, kind: guessedKind })}
                className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1 text-xs text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40"
              >
                + {catName}
              </button>
            ))}
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this category?"
          body="Existing records keep their category text — this only removes it from the managed list."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteCategory(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
