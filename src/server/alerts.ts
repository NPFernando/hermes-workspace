/**
 * Shared alerting helper for the finance/trading engines.
 *
 * Everything in this codebase was audit-log-only (appendAuditLog, written to
 * ~/.hermes/finance/audit.jsonl + Postgres) — nothing paged a human when
 * something serious tripped. connectivity-breaker.ts already had its own
 * one-off Telegram delivery via `hermes send` (see resolveHermesBin); this
 * generalizes that exact mechanism so other consumers (guardian blocks,
 * future strategy-decay detection, etc.) can reuse it instead of each
 * hand-rolling their own spawn() call.
 *
 * Delivery is always best-effort: a thrown/rejected send must never
 * propagate back into a trading cycle. The audit log is the source of
 * truth regardless of whether delivery succeeds.
 */
import { spawn } from 'node:child_process'
import { appendAuditLog, readFinanceStore } from './finance-store'
import { resolveHermesBin } from './hermes-bin'

const ALERT_TARGET = 'telegram:2130622225'

export type AlertSeverity = 'info' | 'warning' | 'critical'

export interface AlertEvent {
  severity: AlertSeverity
  title: string
  detail: string
  source: string
}

const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  critical: '🔴',
}

function alertsEnabled(): boolean {
  const settings = readFinanceStore().settings as Record<string, unknown>
  return settings.alertsEnabled === true
}

function deliverTelegram(event: AlertEvent): void {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return
  try {
    const child = spawn(
      resolveHermesBin(),
      [
        'send',
        '--to',
        ALERT_TARGET,
        '-q',
        `${SEVERITY_EMOJI[event.severity]} ${event.title}\n${event.detail}\n(source: ${event.source})`,
      ],
      { stdio: 'ignore', detached: true },
    )
    child.on('error', () => {
      /* non-fatal — must never throw back into a trading cycle */
    })
    child.unref()
  } catch {
    /* non-fatal */
  }
}

/**
 * Record an alert. Always audit-logs. Delivery to Telegram is best-effort
 * and gated on settings.alertsEnabled — EXCEPT critical severity, which
 * always attempts delivery regardless of the toggle (matches
 * connectivity-breaker.ts's pre-existing unconditional behavior; gating
 * that behind a default-off toggle would be a silent regression for an
 * already-shipped safety alert).
 */
export function sendAlert(event: AlertEvent): void {
  appendAuditLog('alert_sent', {
    severity: event.severity,
    title: event.title,
    detail: event.detail,
    source: event.source,
  })
  if (event.severity !== 'critical' && !alertsEnabled()) return
  deliverTelegram(event)
}
