import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Same sandbox pattern as grid-paper-engine.test.ts: point the finance
// store at a temp HOME so tests never touch ~/.hermes/finance.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exposure-aggregator-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
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

async function seedGridState(
  levels: Array<{ symbol: string; entryQuote: number; held: boolean }>,
) {
  const store = await import('./finance-store')
  const db = store.readFinanceStore()
  const bySymbol = new Map<
    string,
    Array<{ entryQuote: number; held: boolean }>
  >()
  for (const l of levels) {
    const arr = bySymbol.get(l.symbol) ?? []
    arr.push({ entryQuote: l.entryQuote, held: l.held })
    bySymbol.set(l.symbol, arr)
  }
  for (const [symbol, symbolLevels] of bySymbol) {
    db.strategy_results.push({
      kind: 'demo_grid_state',
      symbol,
      armed: true,
      halted: false,
      pausedForChop: false,
      lower: 1,
      upper: 2,
      levels: symbolLevels.map((l) => ({
        price: 1.5,
        held: l.held,
        entryPrice: 1.5,
        entryQuote: l.entryQuote,
        entryFeeQuote: 0,
        openedAt: new Date().toISOString(),
      })),
      lastProcessedOpenTime: 0,
      updatedAt: new Date().toISOString(),
    } as never)
  }
  store.writeFinanceStore(db)
}

describe('crossEngineBucketExposureQuote', () => {
  it('adds grid exposure on top of council exposure in the same bucket', async () => {
    await seedGridState([
      { symbol: 'ETHUSDT', entryQuote: 40, held: true },
      { symbol: 'ETHUSDT', entryQuote: 30, held: true },
    ])
    const { crossEngineBucketExposureQuote } =
      await import('./exposure-aggregator')
    const merged = crossEngineBucketExposureQuote({ majors: 100 }, BUCKETS)
    expect(merged.majors).toBe(170) // 100 council + 40 + 30 grid
  })

  it('ignores unheld grid levels', async () => {
    await seedGridState([{ symbol: 'ETHUSDT', entryQuote: 40, held: false }])
    const { crossEngineBucketExposureQuote } =
      await import('./exposure-aggregator')
    const merged = crossEngineBucketExposureQuote({}, BUCKETS)
    expect(merged.majors ?? 0).toBe(0)
  })

  it('keeps buckets independent — alts exposure never bleeds into majors', async () => {
    await seedGridState([{ symbol: 'XRPUSDT', entryQuote: 25, held: true }])
    const { crossEngineBucketExposureQuote } =
      await import('./exposure-aggregator')
    const merged = crossEngineBucketExposureQuote({ majors: 50 }, BUCKETS)
    expect(merged.majors).toBe(50)
    expect(merged.alts).toBe(25)
  })

  it('returns council exposure unchanged when the grid engine holds nothing', async () => {
    const { crossEngineBucketExposureQuote } =
      await import('./exposure-aggregator')
    const merged = crossEngineBucketExposureQuote({ majors: 75 }, BUCKETS)
    expect(merged).toEqual({ majors: 75 })
  })

  it('symbols outside any configured bucket contribute nothing', async () => {
    await seedGridState([{ symbol: 'DOGEUSDT', entryQuote: 999, held: true }])
    const { crossEngineBucketExposureQuote } =
      await import('./exposure-aggregator')
    const merged = crossEngineBucketExposureQuote({}, BUCKETS)
    expect(merged).toEqual({})
  })
})
