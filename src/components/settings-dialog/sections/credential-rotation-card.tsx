'use client'

import { useEffect, useState } from 'react'

type RotationEntry = {
  key: string
  state: 'valid' | 'expiring' | 'expired' | 'untracked'
  expiresAt: string | null
  daysRemaining: number | null
}

type RotationResponse = {
  ok?: boolean
  summary?: { expired: number; expiring: number; untracked: number }
  statuses?: RotationEntry[]
}

const stateLabel: Record<RotationEntry['state'], string> = {
  valid: 'Current',
  expiring: 'Expiring soon',
  expired: 'Expired',
  untracked: 'Needs metadata',
}

const stateClass: Record<RotationEntry['state'], string> = {
  valid: 'text-[var(--theme-success)]',
  expiring: 'text-[var(--theme-warning)]',
  expired: 'text-[var(--theme-danger)]',
  untracked: 'text-[var(--theme-muted)]',
}

export function CredentialRotationCard() {
  const [data, setData] = useState<RotationResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/secret-rotation')
      .then((response) => response.json() as Promise<RotationResponse>)
      .then((next) => {
        if (!cancelled && next.ok) setData(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!data?.statuses) return null

  const attention = data.statuses.filter((entry) => entry.state !== 'valid')
  return (
    <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[var(--theme-muted)]">
            Credential rotation
          </p>
          <p className="mt-1 text-[11px] text-[var(--theme-muted)]">
            Value-blind reminders for OAuth, backups, and provider credentials.
          </p>
        </div>
        <span className="text-[11px] text-[var(--theme-muted)]">
          {attention.length === 0 ? 'All current' : `${attention.length} need attention`}
        </span>
      </div>
      {attention.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {attention.map((entry) => (
            <div key={entry.key} className="flex items-center justify-between gap-3 text-xs">
              <code className="truncate font-mono text-[var(--theme-text)]">{entry.key}</code>
              <span className={`shrink-0 ${stateClass[entry.state]}`}>
                {stateLabel[entry.state]}
                {entry.state === 'expiring' && entry.daysRemaining !== null
                  ? ` · ${entry.daysRemaining}d`
                  : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
