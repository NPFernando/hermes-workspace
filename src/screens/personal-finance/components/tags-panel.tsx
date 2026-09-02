import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import { buttonClass, inputClass } from '../shared-styles'
import { splitTags, stringField } from '../field-helpers'
import type { PersonalFinancePayload } from '../types'

type EditDraft = {
  name: string
  notes: string
}

/**
 * Tags — real entity (PF-112), matched by name against the comma-separated
 * ExpenseRecord.tags/IncomeRecord.tags free-text fields. Same additive
 * pattern as Category/Subcategory/Merchant, but many-to-many rather than
 * one-per-record: usage counting and "unmanaged" detection tokenize the
 * delimited field instead of comparing a single scalar value.
 */
export function TagsPanel({
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
  const [notes, setNotes] = useState('')

  const tags = payload.data.tags

  async function submitTag(prefill?: { name: string }) {
    const finalName = (prefill?.name ?? name).trim()
    if (!finalName) {
      setErr('Tag name is required')
      return
    }
    const data = await post(
      {
        action: 'add_record',
        kind: 'tag',
        payload: {
          name: finalName,
          notes: prefill ? undefined : notes.trim() || undefined,
        },
      },
      'tag',
    )
    if (data) {
      setName('')
      setNotes('')
    }
  }

  function startEdit(tag: Record<string, unknown>) {
    const id = stringField(tag, 'id')
    setEditDrafts((prev) => ({
      ...prev,
      [id]: {
        name: stringField(tag, 'name'),
        notes: stringField(tag, 'notes'),
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
      setErr('Tag name is required')
      return
    }
    const data = await post(
      {
        action: 'update_record',
        kind: 'tag',
        id,
        payload: {
          name: draft.name.trim(),
          notes: draft.notes.trim() || undefined,
        },
      },
      `edit-${id}`,
    )
    if (data) setEditOpenId(null)
  }

  async function deleteTag(id: string) {
    const data = await post(
      { action: 'delete_record', kind: 'tag', id },
      `delete-${id}`,
    )
    if (data) setConfirmDeleteId(null)
  }

  const usageCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const exp of payload.data.expense_records) {
      for (const t of splitTags(stringField(exp, 'tags')))
        counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    for (const inc of payload.data.income_records) {
      for (const t of splitTags(stringField(inc, 'tags')))
        counts.set(t, (counts.get(t) ?? 0) + 1)
    }
    return counts
  }, [payload.data.expense_records, payload.data.income_records])

  const unmanaged = useMemo(() => {
    const known = new Set(tags.map((t) => stringField(t, 'name')))
    const found = new Set<string>()
    for (const exp of payload.data.expense_records) {
      for (const t of splitTags(stringField(exp, 'tags')))
        if (!known.has(t)) found.add(t)
    }
    for (const inc of payload.data.income_records) {
      for (const t of splitTags(stringField(inc, 'tags')))
        if (!known.has(t)) found.add(t)
    }
    return Array.from(found)
  }, [tags, payload.data.expense_records, payload.data.income_records])

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <datalist id="pf-known-tags">
        {tags.map((t, index) => (
          <option
            key={stringField(t, 'id') || String(index)}
            value={stringField(t, 'name')}
          />
        ))}
      </datalist>

      <h2 className="text-lg font-semibold">Tags</h2>
      <p className="text-xs text-[var(--theme-muted)]">
        A managed list of tags — income and expense records store a
        comma-separated free-text list, so any record can carry several tags.
        Renaming or deleting a tag here does not touch past records.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Tag name"
          value={name}
          onChange={(e) => setName(e.target.value)}
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
          disabled={busy === 'tag'}
          onClick={() => void submitTag()}
          className={buttonClass}
        >
          {busy === 'tag' ? 'Saving…' : 'Add tag'}
        </button>
      </div>

      {err && <p className="mt-2 text-xs text-red-300">{err}</p>}

      <div className="mt-4 grid gap-2">
        {tags.length === 0 && (
          <p className="text-sm text-[var(--theme-muted)]">
            No tags added yet.
          </p>
        )}
        {tags.map((tag, index) => {
          const id = stringField(tag, 'id') || String(index)
          const isEditing = editOpenId === id
          const tagName = stringField(tag, 'name')
          const count = usageCounts.get(tagName) ?? 0

          return (
            <div
              key={id}
              className="rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
            >
              {isEditing ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    placeholder="Tag name"
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
                      {tagName}
                    </span>{' '}
                    <span className="text-xs text-[var(--theme-muted)]">
                      used {count} time{count === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(tag)}
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
            In use, not yet a tag
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {unmanaged.map((tagName) => (
              <button
                key={tagName}
                type="button"
                disabled={busy === 'tag'}
                onClick={() => void submitTag({ name: tagName })}
                className="rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1 text-xs text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40"
              >
                + {tagName}
              </button>
            ))}
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this tag?"
          body="Existing records keep their tag text — this only removes it from the managed list."
          confirmLabel="Delete"
          busy={busy === `delete-${confirmDeleteId}`}
          onConfirm={() => void deleteTag(confirmDeleteId)}
          onCancel={() => setConfirmDeleteId(null)}
        />
      )}
    </section>
  )
}
