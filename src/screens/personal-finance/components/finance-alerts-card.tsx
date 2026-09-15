import { useState } from 'react'
import { buttonClass, dangerTone, neutralTone, warningTone } from '../shared-styles'
import type { PersonalFinancePayload } from '../types'

const ALERT_TONE: Record<'info' | 'warning' | 'critical', string> = {
  info: neutralTone,
  warning: warningTone,
  critical: dangerTone,
}

/** |fxPct| from a "... moved against this holding by N.N% ..." detail
 *  string — the only place that number lives once financeAlerts() has
 *  already formatted it into text. Falls back to 0 (still snoozes, just
 *  re-surfaces at the base threshold instead of accounting for how far
 *  past it this particular alert already was). */
function fxPctFromDetail(detail: string): number {
  const match = /by (\d+(?:\.\d+)?)%/.exec(detail)
  return match ? Number(match[1]) : 0
}

export function FinanceAlertsCard({
  payload,
}: {
  payload: PersonalFinancePayload
}) {
  const [snoozed, setSnoozed] = useState<Set<string>>(new Set())
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const visible = payload.alerts.filter(
    (a) => !a.dismissKey || !snoozed.has(a.dismissKey),
  )
  if (visible.length === 0) return null

  async function snooze(dismissKey: string, detail: string) {
    setSnoozed((prev) => new Set(prev).add(dismissKey))
    setBusyKey(dismissKey)
    try {
      await fetch('/api/finance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'snooze_fx_exposure_alert',
          holdingId: dismissKey,
          fxPct: fxPctFromDetail(detail),
        }),
      })
    } catch {
      // Best-effort, same as the sender-candidate dismissal — the
      // optimistic client-side removal already gives immediate feedback.
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">Alerts</h2>
      <div className="mt-3 grid gap-2">
        {visible.map((alert) => {
          const dismissKey = alert.dismissKey
          return (
            <div
              key={`${alert.title}-${alert.detail}`}
              className={`rounded-2xl border p-3 ${ALERT_TONE[alert.level]}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-[var(--theme-text)]">
                    {alert.title}
                  </p>
                  <p className="text-xs text-[var(--theme-muted)]">
                    {alert.detail}
                  </p>
                </div>
                {dismissKey && (
                  <button
                    type="button"
                    disabled={busyKey === dismissKey}
                    onClick={() => void snooze(dismissKey, alert.detail)}
                    className={`${buttonClass} shrink-0`}
                    title="Stop showing this until the exposure gets meaningfully worse"
                  >
                    Snooze
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
