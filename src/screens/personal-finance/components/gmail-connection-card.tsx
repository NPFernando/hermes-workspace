import { useCallback, useEffect, useState } from 'react'
import { buttonClass, dangerTone, positiveTone } from '../shared-styles'
import { formatSyncAge, gmailSyncHealth } from './gmail-sync-health'

type GmailConnectionStatus = {
  enabled: boolean
  connected: boolean
  email: string | null
  connectedAt: string | null
  lastSyncedAtSeconds: number | null
  syncHistory: Array<{
    at: number
    found: number
    queued: number
    skippedAlreadyQueued: number
  }>
  lastError: { at: number; message: string } | null
}

/**
 * Settings-level view of the Gmail connection — separate from the
 * "Sync now" workflow button in PendingIngestionPanel (ingestion tab).
 * Surfaces connection identity and, critically, `lastError`: a stored
 * refresh token can go stale (Google's `invalid_grant`, or an app still
 * in OAuth "Testing" status expiring tokens after 7 days of no use)
 * without `isGmailConnected()` ever noticing — it only checks that the
 * token *file* exists, not that Google still honours it. Without this
 * card that failure is only visible as a transient toast the moment
 * someone happens to click "Sync now".
 */
export function GmailConnectionCard() {
  const [status, setStatus] = useState<GmailConnectionStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(() => {
    setLoading(true)
    return fetch('/api/auth/gmail-connect?check=1', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: GmailConnectionStatus) => setStatus(data))
      .catch(() => setStatus(null))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !status) {
    return (
      <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
        <p className="text-sm text-[var(--theme-muted)]">
          Checking Gmail connection…
        </p>
      </div>
    )
  }

  if (!status?.enabled) {
    return (
      <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
        <h3 className="text-sm font-medium text-[var(--theme-text)]">
          Gmail connection
        </h3>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">
          Not configured — set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET on the
          server to enable this.
        </p>
      </div>
    )
  }

  const needsReconnect = status.connected && Boolean(status.lastError)
  const syncHealth = gmailSyncHealth(
    status.lastSyncedAtSeconds,
    status.lastError?.at ?? null,
  )
  const syncTone =
    syncHealth === 'healthy'
      ? positiveTone
      : syncHealth === 'failed' || syncHealth === 'stale'
        ? dangerTone
        : 'text-[var(--theme-muted)]'
  const syncLabel = {
    healthy: 'Fresh',
    stale: 'Stale',
    failed: 'Last attempt failed',
    never: 'Never synced',
  }[syncHealth]

  return (
    <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-[var(--theme-text)]">
            Gmail connection
          </h3>
          {status.connected ? (
            <p
              className={`mt-1 text-xs ${needsReconnect ? dangerTone : positiveTone}`}
            >
              {needsReconnect
                ? `Connected as ${status.email ?? 'unknown'}, but the last sync failed — reconnect below.`
                : `Connected as ${status.email ?? 'unknown'}`}
            </p>
          ) : (
            <p className={`mt-1 text-xs ${dangerTone}`}>Not connected</p>
          )}
        </div>
        <a href="/api/auth/gmail-connect" className={buttonClass}>
          {status.connected ? 'Reconnect Gmail' : 'Connect Gmail'}
        </a>
      </div>

      {status.connected && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-xs">
          <span className={syncTone} role="status">
            {syncLabel}
          </span>
          <span className="text-[var(--theme-muted)]">
            {status.lastSyncedAtSeconds
              ? `Last successful sync ${formatSyncAge(status.lastSyncedAtSeconds)}`
              : 'No successful sync yet'}
          </span>
          {status.connectedAt && (
            <span className="text-[var(--theme-muted)]">
              Connected {new Date(status.connectedAt).toLocaleDateString()}
            </span>
          )}
        </p>
      )}

      {status.lastError && (
        <p className={`mt-1 text-xs ${dangerTone}`}>
          Last sync error (
          {new Date(status.lastError.at * 1000).toLocaleString()}):{' '}
          {status.lastError.message}
        </p>
      )}
    </div>
  )
}
