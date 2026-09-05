import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDashboardOverview } from '../src/server/dashboard-aggregator'
import { getFinanceStorageMonitorSummary } from '../src/server/ops-observability'
import { FINANCE_STORAGE_MONITOR_STATE_PATH } from '../src/server/finance-storage-monitor'
import type { DashboardFetcher } from '../src/server/dashboard-aggregator'

type SmokeResult = {
  ok: boolean
  mode: 'finance-storage-monitor-failure-injection'
  realStatePath: string
  realStateMtimeBefore: string | null
  realStateMtimeAfter: string | null
  injectedStatePath: string
  incident: {
    id: string
    severity: string
    source: string
    label: string
    detail: string
    href: string | null
  }
}

function realStateMtime(): string | null {
  try {
    return existsSync(FINANCE_STORAGE_MONITOR_STATE_PATH)
      ? statSync(FINANCE_STORAGE_MONITOR_STATE_PATH).mtime.toISOString()
      : null
  } catch {
    return null
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const failingFetcher: DashboardFetcher = async () =>
  new Response('{}', { status: 404 })

async function main(): Promise<void> {
  const realStateMtimeBefore = realStateMtime()
  const tempDir = mkdtempSync(join(tmpdir(), 'finance-storage-monitor-smoke-'))
  const injectedStatePath = join(tempDir, 'storage-monitor.json')

  try {
    writeFileSync(
      injectedStatePath,
      `${JSON.stringify(
        {
          lastCheckedAt: '2026-07-08T00:00:00.000Z',
          lastHealthyAt: '2026-07-07T23:45:00.000Z',
          lastAlertAt: null,
          consecutiveFailures: 3,
          lastStatus: 'postgres_behind',
          lastWarnings: ['Postgres mirror is 45s behind JSON finance storage.'],
          lastSelfHealAttempts: 2,
          lastSelfHealSucceeded: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    )

    const financeStorageMonitor = getFinanceStorageMonitorSummary({
      statePath: injectedStatePath,
      now: new Date('2026-07-08T00:45:00.000Z'),
      staleAfterMs: 30 * 60_000,
    })
    assert(financeStorageMonitor, 'Injected monitor state did not load')
    assert(financeStorageMonitor.stale, 'Injected monitor state is not stale')

    const overview = await buildDashboardOverview({
      fetcher: failingFetcher,
      financeStorageMonitor,
    })
    const incident = overview.incidents.find(
      (item) => item.id === 'finance-storage-monitor',
    )

    assert(incident, 'Dashboard did not emit finance-storage-monitor incident')
    assert(incident.source === 'finance', 'Incident source is not finance')
    assert(incident.severity === 'error', 'Incident severity is not error')
    assert(incident.href === '/finance', 'Incident does not link to /finance')
    assert(
      incident.detail.includes('45 min ago') ||
        incident.detail.includes('Postgres mirror'),
      `Unexpected incident detail: ${incident.detail}`,
    )

    const result: SmokeResult = {
      ok: true,
      mode: 'finance-storage-monitor-failure-injection',
      realStatePath: FINANCE_STORAGE_MONITOR_STATE_PATH,
      realStateMtimeBefore,
      realStateMtimeAfter: realStateMtime(),
      injectedStatePath,
      incident,
    }
    console.log(JSON.stringify(result, null, 2))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        mode: 'finance-storage-monitor-failure-injection',
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  )
  process.exit(1)
})
