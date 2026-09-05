import * as fs from 'node:fs'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import {
  FINANCE_DATA_DIR,
  appendAuditLog,
  financeStorageAlerts,
  financeStorageStatus,
} from './finance-store'
import { resolveHermesBin } from './hermes-bin'
import type { FinanceStorageHealthStatus } from './finance-store'

export const FINANCE_STORAGE_MONITOR_STATE_PATH = path.join(
  FINANCE_DATA_DIR,
  'storage-monitor.json',
)

const DEFAULT_INTERVAL_MS = 10 * 60_000
const DEFAULT_INITIAL_DELAY_MS = 60_000
const DEFAULT_ALERT_REPEAT_MS = 6 * 60 * 60_000
const DEFAULT_FAILURE_THRESHOLD = 3
const DEFAULT_SELF_HEAL_RETRIES = 2
const DEFAULT_ALERT_TARGET = 'telegram:2130622225'

export type FinanceStorageMonitorState = {
  lastCheckedAt: string | null
  lastHealthyAt: string | null
  lastAlertAt: string | null
  consecutiveFailures: number
  lastStatus: FinanceStorageHealthStatus | null
  lastWarnings: Array<string>
  lastSelfHealAttempts: number
  lastSelfHealSucceeded: boolean | null
}

export type FinanceStorageHeartbeatResult = {
  checkedAt: string
  unhealthy: boolean
  consecutiveFailures: number
  notification: {
    attempted: boolean
    sent: boolean
    reason: string | null
  }
  state: FinanceStorageMonitorState
  storage: ReturnType<typeof financeStorageStatus>
}

type FinanceStorageHeartbeatOptions = {
  now?: () => Date
  statePath?: string
  storageStatus?: () => ReturnType<typeof financeStorageStatus>
  sendAlert?: (message: string) => boolean
  auditLogger?: (action: string, details: Record<string, unknown>) => void
  failureAlertThreshold?: number
  alertRepeatMs?: number
  selfHealRetries?: number
}

type FinanceStorageMonitorStartOptions = FinanceStorageHeartbeatOptions & {
  intervalMs?: number
  initialDelayMs?: number
}

const EMPTY_STATE: FinanceStorageMonitorState = {
  lastCheckedAt: null,
  lastHealthyAt: null,
  lastAlertAt: null,
  consecutiveFailures: 0,
  lastStatus: null,
  lastWarnings: [],
  lastSelfHealAttempts: 0,
  lastSelfHealSucceeded: null,
}

let monitorTimer: ReturnType<typeof setInterval> | null = null
let monitorInitialTimer: ReturnType<typeof setTimeout> | null = null

function envFlagOff(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '0' || value === 'false' || value === 'off' || value === 'no'
}

function positiveNumber(value: unknown): number | null {
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null
}

function envMs(name: string, fallback: number): number {
  return positiveNumber(process.env[name]) ?? fallback
}

function envCount(name: string, fallback: number): number {
  return positiveNumber(process.env[name]) ?? fallback
}

function parseTimeMs(value: string | null | undefined): number {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function defaultStatePath(): string {
  return FINANCE_STORAGE_MONITOR_STATE_PATH
}

export function readFinanceStorageMonitorState(
  statePath: string = defaultStatePath(),
): FinanceStorageMonitorState {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(statePath, 'utf8'),
    ) as Partial<FinanceStorageMonitorState>
    return {
      lastCheckedAt:
        typeof parsed.lastCheckedAt === 'string' ? parsed.lastCheckedAt : null,
      lastHealthyAt:
        typeof parsed.lastHealthyAt === 'string' ? parsed.lastHealthyAt : null,
      lastAlertAt:
        typeof parsed.lastAlertAt === 'string' ? parsed.lastAlertAt : null,
      consecutiveFailures:
        typeof parsed.consecutiveFailures === 'number' &&
        Number.isFinite(parsed.consecutiveFailures)
          ? Math.max(0, Math.floor(parsed.consecutiveFailures))
          : 0,
      lastStatus:
        typeof parsed.lastStatus === 'string' ? parsed.lastStatus : null,
      lastWarnings: Array.isArray(parsed.lastWarnings)
        ? parsed.lastWarnings.filter(
            (warning): warning is string => typeof warning === 'string',
          )
        : [],
      lastSelfHealAttempts:
        typeof parsed.lastSelfHealAttempts === 'number' &&
        Number.isFinite(parsed.lastSelfHealAttempts)
          ? Math.max(0, Math.floor(parsed.lastSelfHealAttempts))
          : 0,
      lastSelfHealSucceeded:
        typeof parsed.lastSelfHealSucceeded === 'boolean'
          ? parsed.lastSelfHealSucceeded
          : null,
    }
  } catch {
    return { ...EMPTY_STATE }
  }
}

function writeFinanceStorageMonitorState(
  state: FinanceStorageMonitorState,
  statePath: string,
): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 })
  const tmp = `${statePath}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, {
    mode: 0o600,
  })
  fs.renameSync(tmp, statePath)
}

function defaultAuditLogger(
  action: string,
  details: Record<string, unknown>,
): void {
  appendAuditLog(action, details)
}

export function formatFinanceStorageOpsAlert(input: {
  checkedAt: string
  consecutiveFailures: number
  storage: ReturnType<typeof financeStorageStatus>
}): string {
  const { health } = input.storage
  const lines = [
    'Finance storage mirror alert',
    `Status: ${health.status}`,
    `Consecutive failed heartbeats: ${input.consecutiveFailures}`,
    `Active storage: ${input.storage.active}`,
    `JSON updated: ${health.jsonUpdatedAt ?? 'unknown'}`,
    `Postgres updated: ${health.postgresUpdatedAt ?? 'unknown'}`,
    `Self-heal: ${
      health.selfHeal.attempted
        ? `${health.selfHeal.succeeded ? 'resolved' : 'unresolved'} after ${health.selfHeal.attempts} attempt(s)`
        : 'not attempted'
    }`,
    `Checked at: ${input.checkedAt}`,
  ]
  if (health.warnings.length > 0) {
    lines.push('Warnings:')
    for (const warning of health.warnings.slice(0, 5)) {
      lines.push(`- ${warning}`)
    }
  }
  return lines.join('\n')
}

export function sendFinanceStorageOpsAlert(message: string): boolean {
  if (envFlagOff('HERMES_FINANCE_STORAGE_ALERTS')) return false
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return false
  const target =
    process.env.HERMES_FINANCE_STORAGE_ALERT_TARGET?.trim() ||
    process.env.HERMES_OPS_ALERT_TARGET?.trim() ||
    DEFAULT_ALERT_TARGET
  try {
    const child = spawn(
      resolveHermesBin(),
      ['send', '--to', target, '-q', message],
      {
        stdio: 'ignore',
        detached: true,
      },
    )
    child.on('error', () => {
      /* non-fatal */
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

export function runFinanceStorageHeartbeat(
  options: FinanceStorageHeartbeatOptions = {},
): FinanceStorageHeartbeatResult {
  const checkedAt = (options.now?.() ?? new Date()).toISOString()
  const nowMs = parseTimeMs(checkedAt)
  const statePath = options.statePath ?? defaultStatePath()
  const previous = readFinanceStorageMonitorState(statePath)
  const selfHealRetries =
    positiveNumber(options.selfHealRetries) ??
    envCount(
      'HERMES_FINANCE_STORAGE_SELF_HEAL_RETRIES',
      DEFAULT_SELF_HEAL_RETRIES,
    )
  const storage =
    options.storageStatus?.() ??
    financeStorageStatus({
      selfHeal: true,
      selfHealRetries,
    })
  const storageAlerts = financeStorageAlerts(storage.health)
  const unhealthy = storageAlerts.length > 0
  const consecutiveFailures = unhealthy ? previous.consecutiveFailures + 1 : 0
  const failureAlertThreshold =
    positiveNumber(options.failureAlertThreshold) ??
    envCount('HERMES_FINANCE_STORAGE_ALERT_FAILURES', DEFAULT_FAILURE_THRESHOLD)
  const alertRepeatMs =
    positiveNumber(options.alertRepeatMs) ??
    envMs('HERMES_FINANCE_STORAGE_ALERT_REPEAT_MS', DEFAULT_ALERT_REPEAT_MS)
  const lastAlertMs = parseTimeMs(previous.lastAlertAt)
  const repeatWindowOpen = !lastAlertMs || nowMs - lastAlertMs >= alertRepeatMs
  const shouldNotify =
    unhealthy &&
    consecutiveFailures >= failureAlertThreshold &&
    repeatWindowOpen
  let notificationAttempted = false
  let notificationSent = false
  let notificationReason: string | null = null

  if (shouldNotify) {
    const message = formatFinanceStorageOpsAlert({
      checkedAt,
      consecutiveFailures,
      storage,
    })
    notificationAttempted = true
    notificationSent = (options.sendAlert ?? sendFinanceStorageOpsAlert)(
      message,
    )
    notificationReason = notificationSent
      ? null
      : 'notification sender returned false'
  } else if (!unhealthy) {
    notificationReason = 'storage healthy'
  } else if (consecutiveFailures < failureAlertThreshold) {
    notificationReason = `waiting for ${failureAlertThreshold} consecutive failure(s)`
  } else {
    notificationReason = 'alert repeat window still closed'
  }

  const nextState: FinanceStorageMonitorState = {
    lastCheckedAt: checkedAt,
    lastHealthyAt: unhealthy ? previous.lastHealthyAt : checkedAt,
    lastAlertAt: notificationAttempted ? checkedAt : previous.lastAlertAt,
    consecutiveFailures,
    lastStatus: storage.health.status,
    lastWarnings: storage.health.warnings,
    lastSelfHealAttempts: storage.health.selfHeal.attempts,
    lastSelfHealSucceeded: storage.health.selfHeal.attempted
      ? storage.health.selfHeal.succeeded
      : null,
  }

  writeFinanceStorageMonitorState(nextState, statePath)

  const audit = options.auditLogger ?? defaultAuditLogger
  if (notificationAttempted) {
    audit('finance_storage_monitor_alerted', {
      checkedAt,
      status: storage.health.status,
      consecutiveFailures,
      warnings: storage.health.warnings,
      notificationSent,
      notificationReason,
      selfHeal: storage.health.selfHeal,
    })
  } else if (!unhealthy && previous.consecutiveFailures > 0) {
    audit('finance_storage_monitor_recovered', {
      checkedAt,
      previousConsecutiveFailures: previous.consecutiveFailures,
      previousStatus: previous.lastStatus,
    })
  }

  return {
    checkedAt,
    unhealthy,
    consecutiveFailures,
    notification: {
      attempted: notificationAttempted,
      sent: notificationSent,
      reason: notificationReason,
    },
    state: nextState,
    storage,
  }
}

function safeRunFinanceStorageHeartbeat(
  options: FinanceStorageHeartbeatOptions = {},
): void {
  try {
    runFinanceStorageHeartbeat(options)
  } catch (error) {
    try {
      appendAuditLog('finance_storage_monitor_heartbeat_failed', {
        message: error instanceof Error ? error.message : String(error),
      })
    } catch {
      /* non-fatal */
    }
  }
}

export function startFinanceStorageMonitor(
  options: FinanceStorageMonitorStartOptions = {},
): boolean {
  if (monitorTimer) return false
  if (envFlagOff('HERMES_FINANCE_STORAGE_MONITOR')) return false
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return false
  if (typeof window !== 'undefined') return false

  const intervalMs =
    positiveNumber(options.intervalMs) ??
    envMs('HERMES_FINANCE_STORAGE_MONITOR_INTERVAL_MS', DEFAULT_INTERVAL_MS)
  const initialDelayMs =
    positiveNumber(options.initialDelayMs) ??
    envMs(
      'HERMES_FINANCE_STORAGE_MONITOR_INITIAL_DELAY_MS',
      DEFAULT_INITIAL_DELAY_MS,
    )

  monitorTimer = setInterval(() => {
    safeRunFinanceStorageHeartbeat(options)
  }, intervalMs)
  monitorTimer.unref()

  monitorInitialTimer = setTimeout(() => {
    monitorInitialTimer = null
    safeRunFinanceStorageHeartbeat(options)
  }, initialDelayMs)
  monitorInitialTimer.unref()

  return true
}

export function stopFinanceStorageMonitor(): boolean {
  let stopped = false
  if (monitorTimer) {
    clearInterval(monitorTimer)
    monitorTimer = null
    stopped = true
  }
  if (monitorInitialTimer) {
    clearTimeout(monitorInitialTimer)
    monitorInitialTimer = null
    stopped = true
  }
  return stopped
}
