import { dangerTone, neutralTone, warningTone } from '../shared-styles'
import { useFinanceAction } from '../../finance/hooks/use-finance-action'
import type { PersonalFinancePayload } from '../types'

const ALERT_TONE: Record<'info' | 'warning' | 'critical', string> = {
  info: neutralTone,
  warning: warningTone,
  critical: dangerTone,
}

export function FinanceAlertsCard({
  payload,
  onPayload,
}: {
  payload: PersonalFinancePayload
  onPayload: (payload: PersonalFinancePayload) => void
}) {
  const { run: post, busy, error } = useFinanceAction<PersonalFinancePayload>(onPayload)
  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <h2 className="text-lg font-semibold text-[var(--theme-text)]">Alerts</h2>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-[var(--theme-muted)]">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={payload.alertsEnabled === true}
            disabled={busy === 'alerts-config'}
            onChange={(event) =>
              void post(
                { action: 'set_alerts_config', enabled: event.target.checked },
                'alerts-config',
              )
            }
          />
          Send non-critical alerts
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={payload.quietModeEnabled === true}
            disabled={busy === 'quiet-mode'}
            onChange={(event) =>
              void post(
                { action: 'set_quiet_mode', enabled: event.target.checked },
                'quiet-mode',
              )
            }
          />
          Quiet mode
        </label>
        <span>Critical alerts always remain deliverable.</span>
      </div>
      {error && <p className="mt-2 text-xs text-[var(--theme-danger)]">{error}</p>}
      <div className="mt-3 grid gap-2">
        {payload.alerts.length === 0 && (
          <p className="text-xs text-[var(--theme-muted)]">No active finance alerts.</p>
        )}
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
