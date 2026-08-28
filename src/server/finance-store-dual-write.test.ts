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

describe('readFinanceStore split-store overlay (Phase 5 read cutover step)', () => {
  it('round-trips through split stores with no data loss or shape change', async () => {
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
    db.strategy_results.push({ id: 'trade-1', kind: 'demo_trade_log', pnlQuote: 12.5 })
    db.settings.tradingMode = 'paper_trade' as never

    store.writeFinanceStore(db)
    const readBack = store.readFinanceStore()

    // Every field must round-trip identically — settings/misc from the base
    // file, personal/trading collections from the overlay, but the caller
    // (every existing consumer of readFinanceStore) sees no difference.
    expect(readBack.income_records).toHaveLength(1)
    expect(readBack.income_records[0]).toMatchObject({ id: 'income-1' })
    expect(readBack.strategy_results).toHaveLength(1)
    expect(readBack.strategy_results[0]).toMatchObject({ id: 'trade-1' })
    expect(readBack.settings.tradingMode).toBe('paper_trade')
  })

  it('falls back to the base file when a split-store mirror is missing', async () => {
    const store = await import('./finance-store')

    const db = store.createEmptyFinanceDatabase()
    db.income_records.push({ id: 'income-1', source: 'test' } as never)
    store.writeFinanceStore(db)

    // Delete the personal mirror to simulate it never having been written
    // (e.g. an older deploy, or a permanent mirror failure) — the base file
    // still has the data, and readFinanceStore must not lose it.
    fs.rmSync(path.join(tmp, '.hermes', 'finance', 'personal-finance.json'))

    const readBack = store.readFinanceStore()
    expect(readBack.income_records).toHaveLength(1)
    expect(readBack.income_records[0]).toMatchObject({ id: 'income-1' })
  })

  it('does not serve stale mirror data when the mirror lags behind the base file', async () => {
    const store = await import('./finance-store')
    const personalStore = await import('./personal-finance-store')

    // Write a real base file (fresh, current timestamp) with one income
    // record, via the normal write path.
    const db = store.createEmptyFinanceDatabase()
    db.income_records.push({ id: 'fresh-income', source: 'fresh' } as never)
    store.writeFinanceStore(db)

    // Now simulate the mirror having fallen behind: overwrite it directly
    // with different data and an old updatedAt, as if its last successful
    // write predates the base file's current content.
    personalStore.writePersonalFinanceStore({
      finance_accounts: [],
      income_records: [{ id: 'stale-income', source: 'stale' }],
      expense_records: [],
      budget_categories: [],
      categories: [],
      savings_goals: [],
      tax_records: [],
      exchange_rates: [],
      investment_accounts: [],
      pending_ingestions: [],
      income_sources: [],
      stock_holdings: [],
      fixed_deposits: [],
    })
    const mirrorPath = path.join(tmp, '.hermes', 'finance', 'personal-finance.json')
    const mirror = JSON.parse(fs.readFileSync(mirrorPath, 'utf-8'))
    mirror.updatedAt = '2020-01-01T00:00:00.000Z'
    fs.writeFileSync(mirrorPath, JSON.stringify(mirror))

    // The overlay must detect the mirror is older than the base file and
    // fall back to the base file's own (fresh) data instead.
    const readBack = store.readFinanceStore()
    expect(readBack.income_records).toHaveLength(1)
    expect(readBack.income_records[0]).toMatchObject({ id: 'fresh-income' })
  })
})
