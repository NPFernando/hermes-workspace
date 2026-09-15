import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buttonClass,
  confirmButtonClass,
  dangerButtonClass,
  dangerTone,
  inputClass,
  positiveTone,
  warningTone,
} from '../shared-styles'
import { parseCsv } from './csv-import-panel'
import type { KnownSender, UnregisteredSenderCandidate } from '../types'

type Draft = {
  id?: string
  label: string
  matchDomain: string
  matchAddress: string
  passwordScheme: string
}

function emptyDraft(): Draft {
  return { label: '', matchDomain: '', matchAddress: '', passwordScheme: '' }
}

function fromSender(s: KnownSender): Draft {
  return {
    id: s.id,
    label: s.label,
    matchDomain: s.matchDomain ?? '',
    matchAddress: s.matchAddress ?? '',
    passwordScheme: s.passwordScheme ?? '',
  }
}

/**
 * Settings-level management of the Gmail known-sender registry
 * (gmail-ingest.ts's buildSearchQuery/matchKnownSender) — before this,
 * the only way to add/edit a sender or set a password was a one-off script
 * run directly against the server. Passwords are write-only from here:
 * `list_known_senders` never returns the encrypted value, only
 * `hasPassword`, so there's no "current password" field to show.
 */
export function KnownSendersCard() {
  const [senders, setSenders] = useState<Array<KnownSender>>([])
  const [candidates, setCandidates] = useState<
    Array<UnregisteredSenderCandidate>
  >([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>(
    {},
  )
  const [importBusy, setImportBusy] = useState(false)
  const [importResult, setImportResult] = useState<{
    imported: number
    skipped: Array<{ row: number; reason: string }>
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(() => {
    setLoading(true)
    return fetch('/api/finance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'list_known_senders' }),
    })
      .then((r) => r.json())
      .then(
        (data: {
          ok: boolean
          knownSenders?: Array<KnownSender>
          unregisteredSenderCandidates?: Array<UnregisteredSenderCandidate>
        }) => {
          if (data.ok) {
            setSenders(data.knownSenders ?? [])
            setCandidates(data.unregisteredSenderCandidates ?? [])
          }
        },
      )
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function save() {
    if (!editing) return
    if (!editing.label.trim()) {
      setNote('Label is required.')
      return
    }
    if (!editing.matchDomain.trim() && !editing.matchAddress.trim()) {
      setNote('Set at least a domain or an address to match on.')
      return
    }
    setBusyId(editing.id ?? 'new')
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_known_sender',
          id: editing.id,
          label: editing.label,
          matchDomain: editing.matchDomain || undefined,
          matchAddress: editing.matchAddress || undefined,
          passwordScheme: editing.passwordScheme || undefined,
        }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) setNote(data.error || 'Save failed')
      else setEditing(null)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function registerCandidate(candidate: UnregisteredSenderCandidate) {
    setBusyId(`candidate-${candidate.senderAddress}`)
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'upsert_known_sender',
          label: candidate.domain,
          matchDomain: candidate.domain,
        }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) setNote(data.error || 'Could not register sender')
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function registerAllHighConfidence() {
    const targets = candidates.filter((c) => c.highConfidence)
    if (targets.length === 0) return
    setBusyId('candidates-bulk')
    setNote(null)
    try {
      // Sequential, not Promise.all — these are writes (upsert_known_sender)
      // and each one changes what future Gmail syncs match on, so keep them
      // ordered and let one failure short-circuit the rest rather than
      // firing every request at once.
      for (const c of targets) {
        const res = await fetch('/api/finance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'upsert_known_sender',
            label: c.domain,
            matchDomain: c.domain,
          }),
        })
        const data = (await res.json()) as { ok: boolean; error?: string }
        if (!data.ok) {
          setNote(data.error || `Could not register ${c.senderAddress}`)
          break
        }
      }
      await load()
    } finally {
      setBusyId(null)
    }
  }

  function dismissCandidate(candidate: UnregisteredSenderCandidate) {
    // Purely client-side for now — the candidate reappears next load since
    // nothing is persisted. Registering it (which removes it from the
    // unmatched pool) is the real dismissal; this just clears the current
    // view without a server round trip for a "not interested" click.
    setCandidates((prev) =>
      prev.filter((c) => c.senderAddress !== candidate.senderAddress),
    )
  }

  async function remove(id: string) {
    setBusyId(id)
    try {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete_known_sender', id }),
      })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function setPassword(id: string) {
    const password = (passwordDrafts[id] ?? '').trim()
    if (!password) return
    setBusyId(id)
    setNote(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'set_known_sender_password', id, password }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string }
      if (!data.ok) setNote(data.error || 'Could not save password')
      else setPasswordDrafts((prev) => ({ ...prev, [id]: '' }))
      await load()
    } finally {
      setBusyId(null)
    }
  }

  async function importCsv(file: File) {
    setImportBusy(true)
    setNote(null)
    setImportResult(null)
    try {
      const text = await file.text()
      const { headers, rows } = parseCsv(text)
      const lower = headers.map((h) => h.trim().toLowerCase())
      const colIndex = (name: string) => lower.indexOf(name)
      const labelCol = colIndex('label')
      const domainCol = colIndex('matchdomain')
      const addressCol = colIndex('matchaddress')
      const schemeCol = colIndex('passwordscheme')
      if (labelCol === -1) {
        setNote(
          'CSV needs a "label" column, plus "matchDomain" and/or "matchAddress". Optional: "passwordScheme".',
        )
        return
      }
      const parsedSenders = rows
        .filter((r) => r.some((cell) => cell.trim()))
        .map((r) => ({
          label: r[labelCol] ?? '',
          matchDomain: domainCol !== -1 ? r[domainCol] : undefined,
          matchAddress: addressCol !== -1 ? r[addressCol] : undefined,
          passwordScheme: schemeCol !== -1 ? r[schemeCol] : undefined,
        }))
      if (parsedSenders.length === 0) {
        setNote('No data rows found in that file.')
        return
      }
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_import_known_senders',
          senders: parsedSenders,
        }),
      })
      const data = (await res.json()) as {
        ok: boolean
        error?: string
        imported?: number
        skipped?: Array<{ row: number; reason: string }>
      }
      if (!data.ok) {
        setNote(data.error || 'Import failed')
        return
      }
      setImportResult({ imported: data.imported ?? 0, skipped: data.skipped ?? [] })
      await load()
    } catch {
      setNote('Could not read that file.')
    } finally {
      setImportBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function clearPassword(id: string) {
    setBusyId(id)
    try {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'clear_known_sender_password', id }),
      })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-[var(--theme-text)]">
          Known Gmail senders
        </h3>
        {!editing && (
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void importCsv(file)
              }}
            />
            <button
              type="button"
              disabled={importBusy}
              onClick={() => fileInputRef.current?.click()}
              className={buttonClass}
            >
              {importBusy ? 'Importing…' : 'Import CSV'}
            </button>
            <button
              type="button"
              onClick={() => setEditing(emptyDraft())}
              className={buttonClass}
            >
              Add sender
            </button>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Registered billers/banks broaden Gmail sync's search beyond generic
        keywords and get tagged on matching pending items. A password here is
        tried automatically to unlock an encrypted PDF from that sender
        before it falls back to manual review.
      </p>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Bulk-add several senders at once: a CSV with a{' '}
        <code>label</code> column plus <code>matchDomain</code> and/or{' '}
        <code>matchAddress</code> (optional <code>passwordScheme</code>) — no
        password column, passwords are always set one at a time below, never
        imported in bulk.
      </p>
      {importResult && (
        <p className={`mt-1 text-xs ${importResult.skipped.length > 0 ? warningTone : positiveTone}`}>
          Imported {importResult.imported} sender
          {importResult.imported === 1 ? '' : 's'}.
          {importResult.skipped.length > 0 &&
            ` Skipped ${importResult.skipped.length} row(s): ${importResult.skipped
              .map((s) => `row ${s.row + 1} (${s.reason})`)
              .join(', ')}.`}
        </p>
      )}

      {candidates.length > 0 && (
        <div className="mt-3 rounded-xl border border-[var(--theme-border)]/60 bg-[color-mix(in_srgb,var(--theme-warning)_8%,transparent)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-medium text-[var(--theme-text)]">
                Detected, not registered yet
              </p>
              <p className="mt-0.5 text-xs text-[var(--theme-muted)]">
                These senders have shown up repeatedly in emails that didn't
                match anything registered — worth adding them?
              </p>
            </div>
            {candidates.some((c) => c.highConfidence) && (
              <button
                type="button"
                disabled={busyId === 'candidates-bulk'}
                onClick={() => void registerAllHighConfidence()}
                className={confirmButtonClass}
              >
                {busyId === 'candidates-bulk'
                  ? 'Registering…'
                  : `Register all high-confidence (${candidates.filter((c) => c.highConfidence).length})`}
              </button>
            )}
          </div>
          <div className="mt-2 grid gap-2">
            {candidates.map((c) => (
              <div
                key={c.senderAddress}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--theme-border)]/50 px-2 py-1"
              >
                <span className="text-xs text-[var(--theme-text)]">
                  {c.senderAddress}
                  <span className="ml-1 text-[var(--theme-muted)]">
                    — seen {c.occurrences}×, last{' '}
                    {new Date(c.lastSeenAt).toLocaleDateString()}
                  </span>
                  {c.highConfidence && (
                    <span className={`ml-1 ${positiveTone}`}>
                      · high confidence
                    </span>
                  )}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === `candidate-${c.senderAddress}`}
                    onClick={() => void registerCandidate(c)}
                    className={confirmButtonClass}
                  >
                    Register
                  </button>
                  <button
                    type="button"
                    onClick={() => dismissCandidate(c)}
                    className={buttonClass}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <div className="mt-3 rounded-xl border border-[var(--theme-border)]/60 p-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="text"
              placeholder="Label (e.g. Commercial Bank)"
              value={editing.label}
              onChange={(e) =>
                setEditing({ ...editing, label: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Match address (e.g. e-statement@bank.com)"
              value={editing.matchAddress}
              onChange={(e) =>
                setEditing({ ...editing, matchAddress: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Or match domain (e.g. bank.com)"
              value={editing.matchDomain}
              onChange={(e) =>
                setEditing({ ...editing, matchDomain: e.target.value })
              }
              className={inputClass}
            />
            <input
              type="text"
              placeholder="Password scheme hint (e.g. date of birth, DDMMYYYY)"
              value={editing.passwordScheme}
              onChange={(e) =>
                setEditing({ ...editing, passwordScheme: e.target.value })
              }
              className={`${inputClass} w-72`}
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busyId === (editing.id ?? 'new')}
              onClick={() => void save()}
              className={confirmButtonClass}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className={buttonClass}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {note && <p className={`mt-2 text-xs ${dangerTone}`}>{note}</p>}

      {loading ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">Loading…</p>
      ) : senders.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--theme-muted)]">
          No senders registered yet.
        </p>
      ) : (
        <div className="mt-3 grid gap-2">
          {senders.map((s) => (
            <div
              key={s.id}
              className="rounded-xl border border-[var(--theme-border)]/60 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-[var(--theme-text)]">
                    {s.label}
                  </p>
                  <p className="text-xs text-[var(--theme-muted)]">
                    {s.matchAddress ?? s.matchDomain}
                    {s.passwordScheme && ` · hint: ${s.passwordScheme}`}
                  </p>
                  <p
                    className={`mt-0.5 text-xs ${s.hasPassword ? positiveTone : 'text-[var(--theme-muted)]'}`}
                  >
                    {s.hasPassword
                      ? 'Password set — auto-unlock enabled'
                      : 'No password set'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => setEditing(fromSender(s))}
                    className={buttonClass}
                  >
                    Edit
                  </button>
                  {s.hasPassword && (
                    <button
                      type="button"
                      disabled={busyId === s.id}
                      onClick={() => void clearPassword(s.id)}
                      className={buttonClass}
                    >
                      Clear password
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => void remove(s.id)}
                    className={dangerButtonClass}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  type="password"
                  placeholder="Set password for auto-unlock"
                  value={passwordDrafts[s.id] ?? ''}
                  onChange={(e) =>
                    setPasswordDrafts((prev) => ({
                      ...prev,
                      [s.id]: e.target.value,
                    }))
                  }
                  className={`${inputClass} w-56`}
                />
                <button
                  type="button"
                  disabled={busyId === s.id}
                  onClick={() => void setPassword(s.id)}
                  className={buttonClass}
                >
                  Save password
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
