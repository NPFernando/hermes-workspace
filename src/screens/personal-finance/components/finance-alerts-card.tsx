import { dangerTone, neutralTone, warningTone } from '../shared-styles'
import type { PersonalFinancePayload } from '../types'

const ALERT_TONE: Record<'info' | 'warning' | 'critical', string> = {
  info: neutralTone,
  warning: warningTone,
  critical: dangerTone,
}

export function FinanceAlertsCard({
  payload,
}: {
  payload: PersonalFinancePayload
}) {
  if (payload.alerts.length === 0) return null
  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">Alerts</h2>
      <div className="mt-3 grid gap-2">
        {payload.alerts.map((alert) => (
          <div
            key={`${alert.title}-${alert.detail}`}
            className={`rounded-2xl border p-3 ${ALERT_TONE[alert.level]}`}
          >
            <p className="text-sm font-medium text-[var(--theme-text)]">
              {alert.title}
            </p>
            <p className="text-xs text-[var(--theme-muted)]">{alert.detail}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
