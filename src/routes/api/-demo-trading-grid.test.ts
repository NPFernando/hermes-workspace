import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Same sandbox pattern as exposure-aggregator.test.ts / grid-paper-engine.test.ts.
let tmp: string
let realHome: string | undefined
let auditPath: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-trading-grid-route-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  auditPath = path.join(tmp, '.hermes', 'finance', 'audit.jsonl')
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

const BUCKETS = {
  majors: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
  alts: ['XRPUSDT'],
}

function readAuditActions(): Array<string> {
  if (!fs.existsSync(auditPath)) return []
  return fs
    .readFileSync(auditPath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => (JSON.parse(line) as { action: string }).action)
}

async function seed(opts: {
  guardianOverride?: Record<string, unknown>
  councilEntryQuote?: number
  gridEntryQuote?: number
}) {
  const store = await import('../../server/finance-store')
  const db = store.readFinanceStore()
  const settings = db.settings as Record<string, unknown>
  settings.demoTrading = {
    guardian: {
      correlationBucketsEnabled: true,
      correlationBuckets: BUCKETS,
      maxBucketExposureQuote: 50,
      ...opts.guardianOverride,
    },
  }
  if (opts.councilEntryQuote !== undefined) {
    db.strategy_results.push({
      kind: 'demo_open_position',
      id: 'pos_1',
      symbol: 'ETHUSDT',
      strategyId: 'sma_crossover',
      entryPrice: 100,
      quantity: 1,
      entryQuote: opts.councilEntryQuote,
      entryFeeQuote: 0,
      openedAt: new Date().toISOString(),
    } as never)
  }
  if (opts.gridEntryQuote !== undefined) {
    db.strategy_results.push({
      kind: 'demo_grid_state',
      symbol: 'ETHUSDT',
      armed: true,
      halted: false,
      pausedForChop: false,
      lower: 1,
      upper: 2,
      levels: [
        {
          price: 1.5,
          held: true,
          entryPrice: 1.5,
          entryQuote: opts.gridEntryQuote,
          entryFeeQuote: 0,
          openedAt: new Date().toISOString(),
        },
      ],
      lastProcessedOpenTime: 0,
      updatedAt: new Date().toISOString(),
    } as never)
  }
  store.writeFinanceStore(db)
}

describe('warnIfCrossEngineExposureBreached', () => {
  it('audit-logs a warning when combined council+grid exposure breaches the cap', async () => {
    await seed({ councilEntryQuote: 30, gridEntryQuote: 30 }) // 60 > 50 cap
    const { warnIfCrossEngineExposureBreached } =
      await import('./demo-trading-grid')
    warnIfCrossEngineExposureBreached()
    expect(readAuditActions()).toContain('grid_cross_engine_exposure_warning')
  })

  it('does not warn when combined exposure stays under the cap', async () => {
    await seed({ councilEntryQuote: 10, gridEntryQuote: 10 }) // 20 < 50 cap
    const { warnIfCrossEngineExposureBreached } =
      await import('./demo-trading-grid')
    warnIfCrossEngineExposureBreached()
    expect(readAuditActions()).not.toContain(
      'grid_cross_engine_exposure_warning',
    )
  })

  it('does nothing when correlationBucketsEnabled is false (ships disarmed)', async () => {
    await seed({
      councilEntryQuote: 100,
      gridEntryQuote: 100,
      guardianOverride: { correlationBucketsEnabled: false },
    })
    const { warnIfCrossEngineExposureBreached } =
      await import('./demo-trading-grid')
    warnIfCrossEngineExposureBreached()
    expect(readAuditActions()).not.toContain(
      'grid_cross_engine_exposure_warning',
    )
  })

  it('neither engine alone breaching the cap still combines to trigger a warning', async () => {
    // Council alone (30) and grid alone (30) are each under the 50 cap,
    // but their combined exposure (60) is over — this is exactly the gap
    // PR #24 flagged: neither engine's own risk check would have caught it.
    await seed({ councilEntryQuote: 30, gridEntryQuote: 30 })
    const { warnIfCrossEngineExposureBreached } =
      await import('./demo-trading-grid')
    warnIfCrossEngineExposureBreached()
    const entries = fs
      .readFileSync(auditPath, 'utf-8')
      .trim()
      .split('\n')
      .map(
        (line) =>
          JSON.parse(line) as {
            action: string
            details: Record<string, unknown>
          },
      )
    const warning = entries.find(
      (e) => e.action === 'grid_cross_engine_exposure_warning',
    )
    expect(warning?.details.exposureQuote).toBe(60)
    expect(warning?.details.bucket).toBe('majors')
  })
})
