import { useCallback, useEffect, useState } from 'react'
import { buttonClass } from '../shared-styles'

type AlertSnooze = {
  key: string
  snoozedAt: string
  magnitudeAtSnooze: number
}

type DismissedSenderCandidate = {
  senderAddress: string
  dismissedAt: string
  occurrencesAtDismissal: number
}

/** Human-readable label for an alert snooze key — mirrors the key formats
 *  each alert type actually uses (see finance-store.ts's getFxExposureAlerts
 *  / financeAlerts / getTaxRecordAlerts) rather than showing the raw key. */
function snoozeLabel(key: string): string {
  if (key.startsWith('budget-pace:')) {
    const [, category, month] = key.split(':')
    return `Budget pace: ${category} (${month})`
  }
  if (key.startsWith('tax-record-quarter:')) {
    return `Tax record nudge: ${key.slice('tax-record-quarter:'.length)}`
  }
  if (key.startsWith('tax-record:')) {
    return `Tax record: ${key.slice('tax-record:'.length)}`
  }
  // Anything else is an FX exposure snooze, keyed by holding id — no
  // human-friendly symbol is available from the key alone.
  return `FX exposure: holding ${key}`
}

/**
 * Every currently-silenced proactive alert and dismissed sender candidate,
 * in one place, each with an early "undo". Before this there was no way to
 * see what was snoozed/dismissed short of reading settings.json directly,
 * or to change your mind early — you'd have to wait for the re-escalation
 * threshold each mechanism already has for a different purpose (catching a
 * situation that's gotten meaningfully worse, not "I want it back now").
 */
export function SnoozeManagementCard() {
  const [snoozes, setSnoozes] = useState<Array<AlertSnooze>>([])
  const [dismissed, setDismissed] = useState<
    Array<DismissedSenderCandidate>
  >([])
  const [loading, setLoading] = useState(true)
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    return fetch('/api/finance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'list_snoozes' }),
    })
      .then((r) => r.json())
      .then(
        (data: {
          ok: boolean
          alertSnoozes?: Array<AlertSnooze>
          dismissedSenderCandidates?: Array<DismissedSenderCandidate>
        }) => {
          if (data.ok) {
            setSnoozes(data.alertSnoozes ?? [])
            setDismissed(data.dismissedSenderCandidates ?? [])
          }
        },
      )
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function unsnooze(key: string) {
    setBusyKey(key)
    try {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'remove_alert_snooze', key }),
      })
      await load()
    } finally {
      setBusyKey(null)
    }
  }

  async function undismiss(senderAddress: string) {
    setBusyKey(senderAddress)
    try {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_dismissed_sender_candidate',
          senderAddress,
        }),
      })
      await load()
    } finally {
      setBusyKey(null)
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
        <p className="text-sm text-[var(--theme-muted)]">Loading…</p>
      </div>
    )
  }

  if (snoozes.length === 0 && dismissed.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
        <h3 className="text-sm font-medium text-[var(--theme-text)]">
          Snoozed &amp; dismissed
        </h3>
        <p className="mt-1 text-xs text-[var(--theme-muted)]">
          Nothing currently silenced.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-[var(--theme-border)]/70 bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] p-4">
      <h3 className="text-sm font-medium text-[var(--theme-text)]">
        Snoozed &amp; dismissed
      </h3>
      <p className="mt-1 text-xs text-[var(--theme-muted)]">
        Every proactive alert you've snoozed and every unregistered-sender
        candidate you've dismissed. Each resurfaces on its own once it gets
        meaningfully worse — or bring it back right now.
      </p>

      {snoozes.length > 0 && (
        <div className="mt-3 grid gap-2">
          {snoozes.map((s) => (
            <div
              key={s.key}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--theme-border)]/50 px-2 py-1"
            >
              <span className="text-xs text-[var(--theme-text)]">
                {snoozeLabel(s.key)}
                <span className="ml-1 text-[var(--theme-muted)]">
                  — snoozed {new Date(s.snoozedAt).toLocaleDateString()}
                </span>
              </span>
              <button
                type="button"
                disabled={busyKey === s.key}
                onClick={() => void unsnooze(s.key)}
                className={buttonClass}
              >
                Un-snooze
              </button>
            </div>
          ))}
        </div>
      )}

      {dismissed.length > 0 && (
        <div className="mt-3 grid gap-2">
          {dismissed.map((d) => (
            <div
              key={d.senderAddress}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--theme-border)]/50 px-2 py-1"
            >
              <span className="text-xs text-[var(--theme-text)]">
                {d.senderAddress}
                <span className="ml-1 text-[var(--theme-muted)]">
                  — dismissed {new Date(d.dismissedAt).toLocaleDateString()}
                </span>
              </span>
              <button
                type="button"
                disabled={busyKey === d.senderAddress}
                onClick={() => void undismiss(d.senderAddress)}
                className={buttonClass}
              >
                Un-dismiss
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
