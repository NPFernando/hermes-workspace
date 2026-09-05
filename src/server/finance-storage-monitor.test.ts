import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildFinanceStorageHealth,
  createEmptyFinanceDatabase,
  financeStorageStatus,
} from './finance-store'
import type { FinanceStorageHealth } from './finance-store'
import {
  readFinanceStorageMonitorState,
  runFinanceStorageHeartbeat,
} from './finance-storage-monitor'

type StorageStatus = ReturnType<typeof financeStorageStatus>

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempStatePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'finance-storage-monitor-'))
  tempDirs.push(dir)
  return join(dir, 'state.json')
}

function storageStatusFor(health: FinanceStorageHealth): StorageStatus {
  return {
    active: health.isPostgresBehindJson ? 'json' : 'postgres',
    fallback: 'json',
    jsonPath: '/tmp/finance.json',
    auditPath: '/tmp/audit.jsonl',
    postgres: {
      enabled: true,
      available: true,
      database: 'finance',
      snapshotAvailable: true,
    },
    health,
  }
}

function unhealthyStorageHealth(): FinanceStorageHealth {
  const jsonDb = createEmptyFinanceDatabase()
  const postgresDb = createEmptyFinanceDatabase()
  jsonDb.updatedAt = '2026-07-08T00:00:30.000Z'
  postgresDb.updatedAt = '2026-07-08T00:00:00.000Z'
  return buildFinanceStorageHealth({
    jsonDb,
    postgresDb,
    postgres: {
      enabled: true,
      available: true,
      snapshotAvailable: true,
      lastWriteError: 'psql exited 1',
    },
    selfHeal: {
      attempted: true,
      attempts: 2,
      succeeded: false,
      lastAttemptAt: '2026-07-08T00:00:31.000Z',
    },
  })
}

function healthyStorageHealth(): FinanceStorageHealth {
  const jsonDb = createEmptyFinanceDatabase()
  const postgresDb = createEmptyFinanceDatabase()
  jsonDb.updatedAt = '2026-07-08T00:00:30.000Z'
  postgresDb.updatedAt = jsonDb.updatedAt
  return buildFinanceStorageHealth({
    jsonDb,
    postgresDb,
    postgres: {
      enabled: true,
      available: true,
      snapshotAvailable: true,
    },
  })
}

describe('finance-storage-monitor', () => {
  it('sends an ops alert only after repeated unresolved mirror failures', () => {
    const statePath = tempStatePath()
    const health = unhealthyStorageHealth()
    const sent: Array<string> = []
    const auditLogger = vi.fn()

    const first = runFinanceStorageHeartbeat({
      statePath,
      now: () => new Date('2026-07-08T00:01:00.000Z'),
      storageStatus: () => storageStatusFor(health),
      sendAlert: (message) => {
        sent.push(message)
        return true
      },
      auditLogger,
      failureAlertThreshold: 2,
      alertRepeatMs: 60_000,
    })

    expect(first.unhealthy).toBe(true)
    expect(first.consecutiveFailures).toBe(1)
    expect(first.notification).toMatchObject({
      attempted: false,
      sent: false,
      reason: 'waiting for 2 consecutive failure(s)',
    })
    expect(sent).toHaveLength(0)

    const second = runFinanceStorageHeartbeat({
      statePath,
      now: () => new Date('2026-07-08T00:11:00.000Z'),
      storageStatus: () => storageStatusFor(health),
      sendAlert: (message) => {
        sent.push(message)
        return true
      },
      auditLogger,
      failureAlertThreshold: 2,
      alertRepeatMs: 60_000,
    })

    expect(second.consecutiveFailures).toBe(2)
    expect(second.notification).toMatchObject({
      attempted: true,
      sent: true,
      reason: null,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('Finance storage mirror alert')
    expect(sent[0]).toContain('Self-heal: unresolved after 2 attempt(s)')
    expect(auditLogger).toHaveBeenCalledWith(
      'finance_storage_monitor_alerted',
      expect.objectContaining({
        status: 'postgres_behind',
        consecutiveFailures: 2,
        notificationSent: true,
      }),
    )
  })

  it('resets failure count and records recovery when storage becomes healthy', () => {
    const statePath = tempStatePath()
    const auditLogger = vi.fn()

    runFinanceStorageHeartbeat({
      statePath,
      now: () => new Date('2026-07-08T00:01:00.000Z'),
      storageStatus: () => storageStatusFor(unhealthyStorageHealth()),
      sendAlert: () => true,
      auditLogger,
      failureAlertThreshold: 1,
      alertRepeatMs: 60_000,
    })

    const recovered = runFinanceStorageHeartbeat({
      statePath,
      now: () => new Date('2026-07-08T00:12:00.000Z'),
      storageStatus: () => storageStatusFor(healthyStorageHealth()),
      sendAlert: () => true,
      auditLogger,
      failureAlertThreshold: 1,
      alertRepeatMs: 60_000,
    })

    expect(recovered.unhealthy).toBe(false)
    expect(recovered.consecutiveFailures).toBe(0)
    expect(recovered.notification.reason).toBe('storage healthy')
    expect(readFinanceStorageMonitorState(statePath)).toMatchObject({
      lastHealthyAt: '2026-07-08T00:12:00.000Z',
      consecutiveFailures: 0,
      lastStatus: 'healthy',
    })
    expect(auditLogger).toHaveBeenCalledWith(
      'finance_storage_monitor_recovered',
      expect.objectContaining({
        previousConsecutiveFailures: 1,
        previousStatus: 'postgres_behind',
      }),
    )
  })
})
