import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Same isolation pattern as rebalance-engine.test.ts / llm-signal-engine.test.ts —
// point HOME at a temp dir so writeFinanceStore (and its trading-side dual-write
// mirror — personal-finance now goes straight to Postgres, see
// finance-store.test.ts's "Postgres Migration Phase D" describe block) never
// touches the real ~/.hermes/finance store.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-dual-write-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('writeFinanceStore dual-write (Phase 5 mirror step, trading side)', () => {
  it('mirrors trading collections into their own split-store file, without leaking personal-finance collections', async () => {
    const store = await import('./finance-store')
    const tradingStore = await import('./trading-store')

    const db = store.createEmptyFinanceDatabase()
    db.income_records.push({
      id: 'income-1',
      dateReceived: '2026-06-28',
      sourceName: 'Salary',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 100_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 100_000,
      taxable: true,
      source: 'test',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    })
    db.strategy_results.push({
      id: 'trade-1',
      kind: 'demo_trade_log',
      pnlQuote: 12.5,
    })

    store.writeFinanceStore(db)

    const trading = tradingStore.readTradingStore()
    expect(trading).not.toBeNull()
    expect(trading?.strategy_results).toHaveLength(1)
    expect(trading?.strategy_results[0]).toMatchObject({ id: 'trade-1' })
    // Trading mirror must not leak personal collections.
    expect(trading).not.toHaveProperty('income_records')
  })

  it('does not throw if the mirror write fails (best-effort only)', async () => {
    const store = await import('./finance-store')

    // Force a real write failure for the trading mirror by pre-creating a
    // directory at the exact path it wants to write a file to (EISDIR) —
    // ESM module exports aren't mockable here (fs.writeFileSync can't be
    // spied on), so this exercises the real failure path instead.
    const financeDir = path.join(tmp, '.hermes', 'finance')
    fs.mkdirSync(path.join(financeDir, 'trading.json'), { recursive: true })

    const db = store.createEmptyFinanceDatabase()
    expect(() => store.writeFinanceStore(db)).not.toThrow()
  })
})

describe('readFinanceStore split-store overlay (Phase 5 read cutover step, trading side)', () => {
  it('round-trips through the trading split store with no data loss or shape change', async () => {
    const store = await import('./finance-store')

    const db = store.createEmptyFinanceDatabase()
    db.income_records.push({
      id: 'income-1',
      dateReceived: '2026-06-28',
      sourceName: 'Salary',
      incomeType: 'Salary',
      originalCurrency: 'LKR',
      originalAmount: 100_000,
      exchangeRateUsed: 1,
      convertedLkrAmount: 100_000,
      taxable: true,
      source: 'test',
      createdAt: '2026-06-28T00:00:00.000Z',
      updatedAt: '2026-06-28T00:00:00.000Z',
    })
    db.strategy_results.push({
      id: 'trade-1',
      kind: 'demo_trade_log',
      pnlQuote: 12.5,
    })
    db.settings.tradingMode = 'paper_trade' as never

    store.writeFinanceStore(db)
    const readBack = store.readFinanceStore()

    // Every field must round-trip identically — settings/misc from the base
    // file, trading collections from the split-store overlay, personal
    // collections from Postgres/base (see finance-store.test.ts) — but the
    // caller (every existing consumer of readFinanceStore) sees no difference.
    expect(readBack.income_records).toHaveLength(1)
    expect(readBack.income_records[0]).toMatchObject({ id: 'income-1' })
    expect(readBack.strategy_results).toHaveLength(1)
    expect(readBack.strategy_results[0]).toMatchObject({ id: 'trade-1' })
    expect(readBack.settings.tradingMode).toBe('paper_trade')
  })
})
