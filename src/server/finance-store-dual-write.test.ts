import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Same isolation pattern as rebalance-engine.test.ts / llm-signal-engine.test.ts —
// point HOME at a temp dir so writeFinanceStore (and its dual-write mirrors)
// never touch the real ~/.hermes/finance store.
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

describe('writeFinanceStore dual-write (Phase 5 mirror step)', () => {
  it('mirrors personal and trading collections into their own split-store files', async () => {
    const store = await import('./finance-store')
    const personalStore = await import('./personal-finance-store')
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
    db.strategy_results.push({ id: 'trade-1', kind: 'demo_trade_log', pnlQuote: 12.5 })

    store.writeFinanceStore(db)

    const personal = personalStore.readPersonalFinanceStore()
    const trading = tradingStore.readTradingStore()

    expect(personal).not.toBeNull()
    expect(personal?.income_records).toHaveLength(1)
    expect(personal?.income_records[0]).toMatchObject({ id: 'income-1' })
    // Personal mirror must not leak trading collections.
    expect(personal).not.toHaveProperty('strategy_results')

    expect(trading).not.toBeNull()
    expect(trading?.strategy_results).toHaveLength(1)
    expect(trading?.strategy_results[0]).toMatchObject({ id: 'trade-1' })
    // Trading mirror must not leak personal collections.
    expect(trading).not.toHaveProperty('income_records')
  })

  it('does not throw if the mirror write fails (best-effort only)', async () => {
    const store = await import('./finance-store')

    // Force a real write failure for the personal mirror by pre-creating a
    // directory at the exact path it wants to write a file to (EISDIR) —
    // ESM module exports aren't mockable here (fs.writeFileSync can't be
    // spied on), so this exercises the real failure path instead.
    const financeDir = path.join(tmp, '.hermes', 'finance')
    fs.mkdirSync(path.join(financeDir, 'personal-finance.json'), { recursive: true })

    const db = store.createEmptyFinanceDatabase()
    expect(() => store.writeFinanceStore(db)).not.toThrow()
  })
})
