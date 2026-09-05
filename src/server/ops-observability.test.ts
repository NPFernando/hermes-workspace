import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getFinanceStorageMonitorSummary,
  getFinanceStorageSmokeCronSummary,
} from './ops-observability'

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function writeStateFile(body: Record<string, unknown>): string {
  const dir = join(tmpdir(), `ops-observability-${Date.now()}-${Math.random()}`)
  tempDirs.push(dir)
  mkdirSync(dir, { recursive: true })
  const statePath = join(dir, 'storage-monitor.json')
  writeFileSync(statePath, `${JSON.stringify(body)}\n`, 'utf8')
  return statePath
}

function makeTempDir(): string {
  const dir = join(tmpdir(), `ops-observability-${Date.now()}-${Math.random()}`)
  tempDirs.push(dir)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('ops-observability finance storage monitor', () => {
  it('summarises monitor state and flags stale heartbeats', () => {
    const statePath = writeStateFile({
      lastCheckedAt: '2026-07-08T00:00:00.000Z',
      lastHealthyAt: '2026-07-07T23:55:00.000Z',
      lastAlertAt: '2026-07-08T00:20:00.000Z',
      consecutiveFailures: 3,
      lastStatus: 'postgres_behind',
      lastWarnings: ['Postgres mirror is 45s behind JSON finance storage.'],
      lastSelfHealAttempts: 2,
      lastSelfHealSucceeded: false,
    })

    expect(
      getFinanceStorageMonitorSummary({
        statePath,
        now: new Date('2026-07-08T00:45:00.000Z'),
        staleAfterMs: 30 * 60_000,
      }),
    ).toMatchObject({
      statePath,
      lastStatus: 'postgres_behind',
      consecutiveFailures: 3,
      heartbeatAgeMs: 45 * 60_000,
      stale: true,
      lastSelfHealAttempts: 2,
      lastSelfHealSucceeded: false,
    })
  })

  it('returns null when the monitor state file does not exist', () => {
    expect(
      getFinanceStorageMonitorSummary({
        statePath: join(tmpdir(), 'missing-storage-monitor.json'),
      }),
    ).toBeNull()
  })
})

describe('ops-observability finance storage smoke cron', () => {
  it('summarises the smoke cron job and latest output artifact', () => {
    const dir = makeTempDir()
    const jobsPath = join(dir, 'jobs.json')
    const outputDir = join(dir, 'output')
    mkdirSync(outputDir, { recursive: true })
    const outputPath = join(outputDir, '2026-07-08_05-49-45.md')
    writeFileSync(
      outputPath,
      [
        '# Cron Job: Finance Storage Monitor Smoke',
        '',
        '**Job ID:** finance-storage-monitor-smoke',
        '**Status:** silent (empty output)',
        '',
      ].join('\n'),
      'utf8',
    )
    writeFileSync(
      jobsPath,
      JSON.stringify(
        {
          jobs: [
            {
              id: 'finance-storage-monitor-smoke',
              name: 'Finance Storage Monitor Smoke',
              schedule: { kind: 'cron', expr: '27 * * * *' },
              enabled: true,
              state: 'scheduled',
              last_status: 'ok',
              last_run_at: '2026-07-08T05:49:45.315739+05:30',
              last_error: null,
              last_delivery_error: null,
              next_run_at: '2026-07-08T06:27:00+05:30',
              repeat: { completed: 1 },
              deliver: 'telegram:2130622225',
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    )

    expect(
      getFinanceStorageSmokeCronSummary({ jobsPath, outputDir }),
    ).toMatchObject({
      jobId: 'finance-storage-monitor-smoke',
      name: 'Finance Storage Monitor Smoke',
      schedule: '27 * * * *',
      enabled: true,
      state: 'scheduled',
      lastStatus: 'ok',
      lastRunAt: '2026-07-08T05:49:45.315739+05:30',
      lastError: null,
      lastDeliveryError: null,
      nextRunAt: '2026-07-08T06:27:00+05:30',
      completedRuns: 1,
      deliver: 'telegram:2130622225',
      latestOutputPath: outputPath,
      latestOutputStatus: 'silent (empty output)',
      recentFailureCount: 0,
      recentOutputs: [
        expect.objectContaining({
          path: outputPath,
          status: 'silent (empty output)',
          failed: false,
        }),
      ],
    })
  })

  it('returns null when the smoke cron job is not registered', () => {
    const dir = makeTempDir()
    const jobsPath = join(dir, 'jobs.json')
    writeFileSync(jobsPath, JSON.stringify({ jobs: [] }), 'utf8')

    expect(getFinanceStorageSmokeCronSummary({ jobsPath })).toBeNull()
  })

  it('classifies Telegram-style failure artifacts even when cron status is ok', () => {
    const dir = makeTempDir()
    const jobsPath = join(dir, 'jobs.json')
    const outputDir = join(dir, 'output')
    mkdirSync(outputDir, { recursive: true })
    writeFileSync(
      join(outputDir, '2026-07-08_06-27-46.md'),
      [
        '# Cron Job: Finance Storage Monitor Smoke',
        '',
        '**Job ID:** finance-storage-monitor-smoke',
        '**Mode:** no_agent (script)',
        '',
        '---',
        '',
        '🔴 finance-storage-monitor-smoke FAILED',
        'ERROR: This version of pnpm requires at least Node.js v22.13',
        '',
      ].join('\n'),
      'utf8',
    )
    writeFileSync(
      jobsPath,
      JSON.stringify({
        jobs: [
          {
            id: 'finance-storage-monitor-smoke',
            name: 'Finance Storage Monitor Smoke',
            schedule: { kind: 'cron', expr: '27 * * * *' },
            enabled: true,
            last_status: 'ok',
            repeat: { completed: 2 },
          },
        ],
      }),
      'utf8',
    )

    expect(
      getFinanceStorageSmokeCronSummary({ jobsPath, outputDir }),
    ).toMatchObject({
      lastStatus: 'ok',
      completedRuns: 2,
      latestOutputStatus: 'failed',
      recentFailureCount: 1,
    })
  })

  it('keeps recent failed artifacts visible after a later successful run', () => {
    const dir = makeTempDir()
    const jobsPath = join(dir, 'jobs.json')
    const outputDir = join(dir, 'output')
    mkdirSync(outputDir, { recursive: true })
    const failurePath = join(outputDir, '2026-07-08_06-27-46.md')
    const successPath = join(outputDir, '2026-07-08_07-27-48.md')
    writeFileSync(
      failurePath,
      [
        '# Cron Job: Finance Storage Monitor Smoke',
        '',
        '**Run Time:** 2026-07-08 06:27:46',
        '',
        '---',
        '',
        '🔴 finance-storage-monitor-smoke FAILED',
        'ERROR: pnpm used the wrong Node binary',
        '',
      ].join('\n'),
      'utf8',
    )
    writeFileSync(
      successPath,
      [
        '# Cron Job: Finance Storage Monitor Smoke',
        '',
        '**Run Time:** 2026-07-08 07:27:48',
        '**Status:** silent (empty output)',
        '',
      ].join('\n'),
      'utf8',
    )
    utimesSync(
      failurePath,
      new Date('2026-07-08T00:57:46.000Z'),
      new Date('2026-07-08T00:57:46.000Z'),
    )
    utimesSync(
      successPath,
      new Date('2026-07-08T01:57:48.000Z'),
      new Date('2026-07-08T01:57:48.000Z'),
    )
    writeFileSync(
      jobsPath,
      JSON.stringify({
        jobs: [
          {
            id: 'finance-storage-monitor-smoke',
            name: 'Finance Storage Monitor Smoke',
            schedule: { kind: 'cron', expr: '27 * * * *' },
            enabled: true,
            last_status: 'ok',
            repeat: { completed: 3 },
          },
        ],
      }),
      'utf8',
    )

    const summary = getFinanceStorageSmokeCronSummary({
      jobsPath,
      outputDir,
      recentOutputLimit: 2,
    })

    expect(summary).toMatchObject({
      latestOutputPath: successPath,
      latestOutputStatus: 'silent (empty output)',
      recentFailureCount: 1,
    })
    expect(summary?.recentOutputs).toEqual([
      expect.objectContaining({
        path: successPath,
        runTime: '2026-07-08 07:27:48',
        status: 'silent (empty output)',
        failed: false,
      }),
      expect.objectContaining({
        path: failurePath,
        runTime: '2026-07-08 06:27:46',
        status: 'failed',
        failed: true,
      }),
    ])
  })

  it('drops failed artifacts after enough newer successful outputs exist', () => {
    const dir = makeTempDir()
    const jobsPath = join(dir, 'jobs.json')
    const outputDir = join(dir, 'output')
    mkdirSync(outputDir, { recursive: true })
    const failurePath = join(outputDir, '2026-07-08_06-27-46.md')
    writeFileSync(
      failurePath,
      [
        '# Cron Job: Finance Storage Monitor Smoke',
        '',
        '**Run Time:** 2026-07-08 06:27:46',
        '',
        '---',
        '',
        '🔴 finance-storage-monitor-smoke FAILED',
        'ERROR: pnpm used the wrong Node binary',
        '',
      ].join('\n'),
      'utf8',
    )
    utimesSync(
      failurePath,
      new Date('2026-07-08T00:57:46.000Z'),
      new Date('2026-07-08T00:57:46.000Z'),
    )

    for (let i = 0; i < 12; i += 1) {
      const hour = 7 + i
      const filePath = join(
        outputDir,
        `2026-07-08_${String(hour).padStart(2, '0')}-27-00.md`,
      )
      writeFileSync(
        filePath,
        [
          '# Cron Job: Finance Storage Monitor Smoke',
          '',
          `**Run Time:** 2026-07-08 ${String(hour).padStart(2, '0')}:27:00`,
          '**Status:** silent (empty output)',
          '',
        ].join('\n'),
        'utf8',
      )
      const mtime = new Date(
        `2026-07-08T${String(hour).padStart(2, '0')}:57:00.000Z`,
      )
      utimesSync(filePath, mtime, mtime)
    }

    writeFileSync(
      jobsPath,
      JSON.stringify({
        jobs: [
          {
            id: 'finance-storage-monitor-smoke',
            name: 'Finance Storage Monitor Smoke',
            schedule: { kind: 'cron', expr: '27 * * * *' },
            enabled: true,
            last_status: 'ok',
            repeat: { completed: 14 },
          },
        ],
      }),
      'utf8',
    )

    const summary = getFinanceStorageSmokeCronSummary({
      jobsPath,
      outputDir,
      recentOutputLimit: 12,
    })

    expect(summary?.recentFailureCount).toBe(0)
    expect(summary?.recentOutputs).toHaveLength(12)
    expect(summary?.recentOutputs.some((output) => output.failed)).toBe(false)
    expect(
      summary?.recentOutputs.some((output) => output.path === failurePath),
    ).toBe(false)
  })
})
