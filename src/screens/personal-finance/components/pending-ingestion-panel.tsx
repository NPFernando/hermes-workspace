import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExtractedTransaction, PendingIngestion, PersonalFinancePayload } from '../types'

type DuplicateWarning = { date: string; amount: number; vendorOrSource: string }

const confidenceTone: Record<ExtractedTransaction['confidence'], string> = {
  high: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-100',
  medium: 'border-amber-400/30 bg-amber-500/15 text-amber-100',
  low: 'border-red-400/30 bg-red-500/15 text-red-100',
}

/**
 * AI-assisted intake: upload a receipt/bill photo or PDF, or sync Gmail —
 * every extracted item lands here for review and never touches real
 * income/expense records until the user confirms it.
 */
export function PendingIngestionPanel({
  onConfirmed,
}: {
  onConfirmed: (payload: PersonalFinancePayload) => void
}) {
  const [items, setItems] = useState<Array<PendingIngestion>>([])
  const [uploading, setUploading] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({})
  const [editDrafts, setEditDrafts] = useState<Record<string, Partial<ExtractedTransaction>>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [gmailConnected, setGmailConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [duplicateWarnings, setDuplicateWarnings] = useState<Record<string, DuplicateWarning>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    fetch('/api/auth/gmail-connect?check=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { connected?: boolean }) => setGmailConnected(Boolean(data.connected)))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'list_pending_ingestions' }),
      })
      const data = (await res.json()) as { ok: boolean; pendingIngestions?: Array<PendingIngestion> }
      if (data.ok) {
        setItems((data.pendingIngestions ?? []).filter((p) => p.status === 'awaiting_password' || p.status === 'awaiting_review'))
      }
    } catch {
      /* transient */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function syncGmail() {
    setSyncing(true)
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'sync_gmail_now' }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        result?: { found: number; queued: number; skippedAlreadyQueued: number }
      }
      if (!data.ok) setNote(data.error || 'Gmail sync failed')
      else if (data.result) setNote(`Found ${data.result.found}, queued ${data.result.queued} for review.`)
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Gmail sync failed')
    } finally {
      setSyncing(false)
    }
  }

  async function uploadFile(file: File) {
    setUploading(true)
    setNote(null)
    try {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch('/api/finance-upload', { method: 'POST', body: form })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) setNote(data.error || 'Upload failed')
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function submitPassword(id: string) {
    const password = (passwordDrafts[id] ?? '').trim()
    if (!password) return
    setBusyId(id)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'submit_ingestion_password', id, password }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) setNote(data.error || 'Could not unlock document')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    setBusyId(id)
    try {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reject_pending_ingestion', id }),
      })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function confirmItem(item: PendingIngestion, force = false) {
    const draft = { ...item.extracted, ...editDrafts[item.id] }
    if (!draft.kind || !Number.isFinite(draft.amount)) {
      setNote('Amount and type are required before confirming.')
      return
    }
    setBusyId(item.id)
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm_pending_ingestion', id: item.id, payload: draft, force }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        duplicateWarning?: { date: string; amount: number; vendorOrSource: string }
      }
      if (data.ok === false) {
        setNote(data.error || 'Confirm failed')
        return
      }
      if (data.duplicateWarning) {
        setDuplicateWarnings((prev) => ({ ...prev, [item.id]: data.duplicateWarning! }))
        return
      }
      setDuplicateWarnings((prev) => {
        const next = { ...prev }
        delete next[item.id]
        return next
      })
      onConfirmed(data as PersonalFinancePayload)
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setBusyId(null)
    }
  }

  function updateDraft(id: string, patch: Partial<ExtractedTransaction>) {
    setEditDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  const inputClass =
    'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs text-[var(--theme-text)] outline-none'
  const buttonClass =
    'rounded-xl border border-[var(--theme-border)] bg-black/10 px-3 py-1.5 text-xs font-medium text-[var(--theme-text)] hover:bg-black/20 disabled:opacity-40'

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">AI-assisted intake</h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Upload a photo or document of a bill/receipt and AI extracts the details — nothing
            is added to your records until you review and confirm it below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadFile(file)
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className={buttonClass}
          >
            {uploading ? 'Processing…' : 'Upload receipt / bill'}
          </button>
          {gmailConnected ? (
            <button type="button" disabled={syncing} onClick={() => void syncGmail()} className={buttonClass}>
              {syncing ? 'Syncing…' : 'Sync Gmail now'}
            </button>
          ) : (
            <a href="/api/auth/gmail-connect" className={buttonClass}>
              Connect Gmail
            </a>
          )}
        </div>
      </div>

      {note && <p className="mt-2 text-xs text-red-300">{note}</p>}

      {items.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">
          Nothing pending — upload a receipt or bill to try it.
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {items.map((item) => {
            const hasDuplicateWarning = Object.hasOwn(duplicateWarnings, item.id)
            const duplicateWarning = duplicateWarnings[item.id]
            return (
            <div
              key={item.id}
              className="flex flex-wrap items-start gap-3 rounded-2xl border border-[var(--theme-border)]/70 bg-black/10 p-3"
            >
              {item.rawPreviewImagePath && (
                <img
                  src={`/api/finance-upload?id=${item.id}`}
                  alt="Document preview"
                  className="h-24 w-24 rounded-xl border border-[var(--theme-border)]/60 object-cover"
                />
              )}

              <div className="min-w-[220px] flex-1">
                <div className="flex items-center gap-2 text-xs text-[var(--theme-muted)]">
                  <span className="uppercase tracking-wide">{item.source}</span>
                  <span>·</span>
                  <span>{item.status.replace('_', ' ')}</span>
                </div>

                {item.status === 'awaiting_password' && (
                  <div className="mt-2">
                    {item.passwordHint && (
                      <p className="text-xs text-[var(--theme-muted)]">Hint: {item.passwordHint}</p>
                    )}
                    {item.error && <p className="mt-1 text-xs text-red-300">{item.error}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        type="password"
                        placeholder="Document password"
                        value={passwordDrafts[item.id] ?? ''}
                        onChange={(e) => setPasswordDrafts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        className={inputClass}
                      />
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void submitPassword(item.id)}
                        className={buttonClass}
                      >
                        Unlock
                      </button>
                    </div>
                  </div>
                )}

                {item.status === 'awaiting_review' && (
                  <div className="mt-2">
                    {item.error && !item.extracted && (
                      <p className="text-xs text-amber-200">
                        Automatic extraction failed ({item.error}) — enter the details manually below.
                      </p>
                    )}
                    {item.extracted && (
                      <span
                        className={`mb-2 inline-block rounded-lg border px-2 py-0.5 text-[10px] uppercase tracking-wide ${confidenceTone[item.extracted.confidence]}`}
                      >
                        {item.extracted.confidence} confidence
                      </span>
                    )}
                    <div className="mt-1 flex flex-wrap gap-2">
                      <select
                        value={(editDrafts[item.id] ?? {}).kind ?? item.extracted?.kind ?? 'expense'}
                        onChange={(e) => updateDraft(item.id, { kind: e.target.value as 'income' | 'expense' })}
                        className={inputClass}
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                      </select>
                      <input
                        type="number"
                        placeholder="Amount"
                        defaultValue={item.extracted?.amount}
                        onChange={(e) => updateDraft(item.id, { amount: Number(e.target.value) })}
                        className={`${inputClass} w-28`}
                      />
                      <input
                        type="text"
                        placeholder="Currency"
                        defaultValue={item.extracted?.currency ?? 'LKR'}
                        onChange={(e) => updateDraft(item.id, { currency: e.target.value })}
                        className={`${inputClass} w-20`}
                      />
                      <input
                        type="text"
                        placeholder="Vendor / source"
                        defaultValue={item.extracted?.vendorOrSource}
                        onChange={(e) => updateDraft(item.id, { vendorOrSource: e.target.value })}
                        className={inputClass}
                      />
                      <input
                        type="date"
                        defaultValue={item.extracted?.date}
                        onChange={(e) => updateDraft(item.id, { date: e.target.value })}
                        className={inputClass}
                      />
                      <input
                        type="text"
                        placeholder="Category"
                        defaultValue={item.extracted?.category}
                        onChange={(e) => updateDraft(item.id, { category: e.target.value })}
                        className={inputClass}
                      />
                    </div>
                    {hasDuplicateWarning && (
                      <p className="mt-2 text-xs text-amber-200">
                        Possible duplicate: an existing record for "{duplicateWarning.vendorOrSource}" on{' '}
                        {duplicateWarning.date} for {duplicateWarning.amount} already exists.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                {item.status === 'awaiting_review' && (
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void confirmItem(item, hasDuplicateWarning)}
                    className="rounded-xl border border-emerald-400/30 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    {hasDuplicateWarning ? 'Confirm anyway' : 'Confirm'}
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => void reject(item.id)}
                  className="rounded-xl border border-red-400/30 bg-red-500/15 px-4 py-2 text-sm font-medium text-red-100 hover:bg-red-500/25 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
