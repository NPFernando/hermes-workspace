'use client'

import { useEffect, useState } from 'react'
import { SectionHeader, SETTINGS_CARD_CLASS } from './settings-dialog-primitives'

type BackupCheck = { status?: string; detail?: string }
type ReadinessResponse = {
  report?: { checks?: { backups?: BackupCheck } }
}

export function BackupsContent() {
  const [backup, setBackup] = useState<BackupCheck | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/production-readiness?skipTests=1')
      .then((response) => response.json() as Promise<ReadinessResponse>)
      .then((next) => {
        if (!cancelled) setBackup(next.report?.checks?.backups ?? null)
      })
      .catch(() => {
        if (!cancelled) setBackup(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const status = backup?.status ?? 'unknown'
  const tone =
    status === 'pass'
      ? 'text-[var(--theme-success)]'
      : status === 'fail'
        ? 'text-[var(--theme-danger)]'
        : 'text-[var(--theme-warning)]'

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Backups"
        description="Review encrypted Finance backup readiness without exposing credentials or payloads."
      />
      <div className={SETTINGS_CARD_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-[var(--theme-text)]">Off-site Finance backup</p>
            <p className="text-xs text-[var(--theme-muted)]">
              Configuration, timer, and recent restore evidence are checked by the production preflight.
            </p>
          </div>
          <span className={`text-xs font-semibold uppercase ${tone}`}>{status}</span>
        </div>
        <p className="mt-3 text-xs text-[var(--theme-muted)]">
          {backup?.detail ?? 'Loading backup readiness…'}
        </p>
      </div>
      <div className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-2.5 text-xs text-[var(--theme-muted)]">
        Restore drills remain preview-safe and require an operator-supplied passphrase and configured off-site remote.
      </div>
    </div>
  )
}
