import { useState } from 'react'
import { ConfirmDialog } from '../../../components/confirm-dialog'

function textValue(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  if (value == null || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString('en-LK')
  return String(value)
}

function inputTypeFor(value: unknown): 'number' | 'checkbox' | 'text' {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'checkbox'
  return 'text'
}

const inputClass =
  'w-full rounded-lg border border-[var(--theme-border)] bg-black/10 px-2 py-1 text-xs text-[var(--theme-text)] outline-none'

/**
 * Optional per-row edit/delete — only rendered when both `kind` (the
 * finance-store record kind, e.g. 'expense') and `onChanged` are passed.
 * Calls the existing `update_record`/`delete_record` actions on
 * /api/finance directly rather than going through useFinanceAction, since
 * this component is shared across record shapes that don't share a common
 * payload type (see PersonalFinancePayload vs. whatever trading-screen.tsx
 * might eventually pass) — callers cast `onChanged`'s argument themselves.
 */
type SortDirection = 'asc' | 'desc'

export function DataTable({
  title,
  rows,
  columns,
  kind,
  onChanged,
  searchable,
}: {
  title: string
  rows: Array<Record<string, unknown>>
  columns: Array<string>
  kind?: string
  onChanged?: (payload: unknown) => void
  /** Opt-in: adds a search box and click-to-sort column headers. Off by default so other DataTable consumers are unaffected. */
  searchable?: boolean
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc')
  const editable = Boolean(kind && onChanged)

  function toggleSort(column: string) {
    if (sortColumn !== column) {
      setSortColumn(column)
      setSortDirection('asc')
    } else if (sortDirection === 'asc') {
      setSortDirection('desc')
    } else {
      setSortColumn(null)
    }
  }

  const trimmedSearch = search.trim().toLowerCase()
  const filtered = trimmedSearch
    ? rows.filter((row) =>
        columns.some((column) =>
          textValue(row, column).toLowerCase().includes(trimmedSearch),
        ),
      )
    : rows

  const sorted = sortColumn
    ? [...filtered].sort((a, b) => {
        const av = a[sortColumn]
        const bv = b[sortColumn]
        let cmp: number
        if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv
        else
          cmp = textValue(a, sortColumn).localeCompare(textValue(b, sortColumn))
        return sortDirection === 'asc' ? cmp : -cmp
      })
    : filtered

  // A search or sort implies looking beyond the recent-8 default — show
  // everything matching instead of silently hiding older rows.
  const visibleRows =
    searchable && (trimmedSearch || sortColumn) ? sorted : sorted.slice(-8)

  function startEdit(row: Record<string, unknown>) {
    setError(null)
    setEditingId(String(row.id))
    setDraft({ ...row })
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft({})
  }

  async function saveEdit(id: string) {
    if (!kind || !onChanged) return
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {}
      for (const column of columns) payload[column] = draft[column]
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'update_record', kind, id, payload }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (data.ok === false) {
        setError(data.error || 'Update failed')
        return
      }
      onChanged(data)
      cancelEdit()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!kind || !onChanged || !confirmDeleteId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'delete_record',
          kind,
          id: confirmDeleteId,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (data.ok === false) {
        // Keep the confirm dialog open with the error visible — closing it
        // silently on failure is indistinguishable from the delete having
        // succeeded (the original bug: a failed delete looked identical to
        // a successful one).
        setError(data.error || 'Delete failed')
        return
      }
      onChanged(data)
      setConfirmDeleteId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--theme-text)]">
          {title}
        </h2>
        <div className="flex items-center gap-2">
          {searchable && rows.length > 0 && (
            <input
              type="text"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-full border border-[var(--theme-border)] bg-black/10 px-3 py-1 text-xs text-[var(--theme-text)] outline-none"
            />
          )}
          <span className="rounded-full border border-[var(--theme-border)] px-2.5 py-1 text-xs text-[var(--theme-muted)]">
            {visibleRows.length === rows.length
              ? rows.length
              : `${visibleRows.length} / ${rows.length}`}{' '}
            records
          </span>
        </div>
      </div>
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--theme-muted)]">
          No records yet. Add records through /api/finance or future forms; the
          database is initialized and ready.
        </p>
      ) : visibleRows.length === 0 ? (
        <p className="text-sm text-[var(--theme-muted)]">
          No records match "{search}".
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.18em] text-[var(--theme-muted)]">
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className={`border-b border-[var(--theme-border)] py-2 pr-4 ${searchable ? 'cursor-pointer select-none hover:text-[var(--theme-text)]' : ''}`}
                    onClick={searchable ? () => toggleSort(column) : undefined}
                  >
                    {column}
                    {sortColumn === column &&
                      (sortDirection === 'asc' ? ' ▲' : ' ▼')}
                  </th>
                ))}
                {editable && (
                  <th className="border-b border-[var(--theme-border)] py-2 pr-4">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, index) => {
                const rowId = String(row.id ?? index)
                const isEditing = editable && editingId === rowId
                return (
                  <tr key={rowId} className="text-[var(--theme-text)]">
                    {columns.map((column) => (
                      <td
                        key={column}
                        className="border-b border-[var(--theme-border)]/60 py-2 pr-4"
                      >
                        {isEditing ? (
                          inputTypeFor(row[column]) === 'checkbox' ? (
                            <input
                              type="checkbox"
                              checked={Boolean(draft[column])}
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  [column]: e.target.checked,
                                }))
                              }
                            />
                          ) : (
                            <input
                              type={inputTypeFor(row[column])}
                              value={
                                draft[column] == null
                                  ? ''
                                  : String(draft[column])
                              }
                              onChange={(e) =>
                                setDraft((prev) => ({
                                  ...prev,
                                  [column]:
                                    inputTypeFor(row[column]) === 'number'
                                      ? Number(e.target.value)
                                      : e.target.value,
                                }))
                              }
                              className={inputClass}
                            />
                          )
                        ) : (
                          textValue(row, column)
                        )}
                      </td>
                    ))}
                    {editable && (
                      <td className="border-b border-[var(--theme-border)]/60 py-2 pr-4">
                        {isEditing ? (
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void saveEdit(rowId)}
                              className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={cancelEdit}
                              className="rounded-lg border border-[var(--theme-border)] bg-black/10 px-2 py-1 text-xs text-[var(--theme-text)] hover:bg-black/20"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEdit(row)}
                              className="rounded-lg border border-[var(--theme-border)] bg-black/10 px-2 py-1 text-xs text-[var(--theme-text)] hover:bg-black/20"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(rowId)}
                              className="rounded-lg border border-red-400/30 bg-red-500/15 px-2 py-1 text-xs text-red-100 hover:bg-red-500/25"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmDeleteId && (
        <ConfirmDialog
          title="Delete this record?"
          body={
            error ? `${error} — try again or cancel.` : "This can't be undone."
          }
          confirmLabel="Delete"
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            setConfirmDeleteId(null)
            setError(null)
          }}
        />
      )}
    </section>
  )
}
