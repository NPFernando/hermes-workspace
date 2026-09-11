import { useCallback, useEffect, useState } from 'react'
import {
  buttonClass,
  confirmButtonClass,
  dangerButtonClass,
  dangerTone,
  inputClass,
  positiveTone,
} from '../shared-styles'
import type { KnownSender } from '../types'

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
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>(
    {},
  )

  const load = useCallback(() => {
    setLoading(true)
    return fetch('/api/finance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'list_known_senders' }),
    })
      .then((r) => r.json())
      .then((data: { ok: boolean; knownSenders?: Array<KnownSender> }) => {
        if (data.ok) setSenders(data.knownSenders ?? [])
      })
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
          <button
            type="button"
            onClick={() => setEditing(emptyDraft())}
            className={buttonClass}
          >
            Add sender
          </button>
        )}
      </div>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Registered billers/banks broaden Gmail sync's search beyond generic
        keywords and get tagged on matching pending items. A password here is
        tried automatically to unlock an encrypted PDF from that sender
        before it falls back to manual review.
      </p>

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
