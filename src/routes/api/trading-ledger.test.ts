import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Same isolation pattern as -demo-trading-grid.test.ts / trading-summary.test.ts —
// point HOME at a temp dir so readFinanceStore/writeFinanceStore never touch
// the real ~/.hermes/finance store.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-ledger-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function seedAllEngines() {
  const store = await import('../server/finance-store')
  const db = store.readFinanceStore()
  db.settings.tradingMode = 'testnet_execute' as never // -> council executionMode 'testnet'

  // Council: one open position, one closed trade.
  db.strategy_results.push({
    kind: 'demo_open_position',
    id: 'council_pos_1',
    symbol: 'BTCUSDT',
    strategyId: 'sma_crossover',
    entryPrice: 50_000,
    quantity: 0.01,
    entryQuote: 500,
    entryFeeQuote: 0.5,
    openedAt: '2026-01-01T00:00:00.000Z',
    executionMode: 'testnet',
  } as never)
  db.strategy_results.push({
    kind: 'demo_trade_log',
    id: 'council_trade_1',
    symbol: 'ETHUSDT',
    strategyId: 'rsi_reversion',
    entryPrice: 2_000,
    exitPrice: 2_100,
    quantity: 0.1,
    entryQuote: 200,
    exitQuote: 210,
    pnlQuote: 10,
    feesQuote: 0.2,
    reason: 'take_profit',
    openedAt: '2026-01-02T00:00:00.000Z',
    closedAt: '2026-01-03T00:00:00.000Z',
    executionMode: 'testnet',
  } as never)

  // Grid: one held level (open), one closed grid trade.
  db.strategy_results.push({
    kind: 'demo_grid_state',
    symbol: 'SOLUSDT',
    armed: true,
    halted: false,
    pausedForChop: false,
    lower: 100,
    upper: 200,
    levels: [
      {
        price: 150,
        held: true,
        entryPrice: 150,
        entryQuote: 30,
        entryFeeQuote: 0.03,
        openedAt: '2026-01-04T00:00:00.000Z',
      },
      // Not held — must be excluded from the ledger entirely.
      {
        price: 160,
        held: false,
        entryPrice: 160,
        entryQuote: 0,
        entryFeeQuote: 0,
        openedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    lastProcessedOpenTime: 0,
    updatedAt: '2026-01-04T00:00:00.000Z',
  } as never)
  db.strategy_results.push({
    kind: 'demo_grid_trade',
    id: 'grid_trade_1',
    symbol: 'BNBUSDT',
    levelIndex: 2,
    entryPrice: 300,
    exitPrice: 310,
    quantity: 1,
    entryQuote: 300,
    exitQuote: 310,
    pnlQuote: 10,
    feesQuote: 0.3,
    reason: 'grid-fill',
    openedAt: '2026-01-05T00:00:00.000Z',
    closedAt: '2026-01-06T00:00:00.000Z',
  } as never)

  // LLM signal: one open position, one BUY trade, one SELL trade with P&L.
  db.strategy_results.push({
    kind: 'demo_llm_position',
    id: 'llm_pos_1',
    symbol: 'XRPUSDT',
    entryPrice: 0.5,
    quantity: 100,
    entryQuote: 50,
    openedAt: '2026-01-07T00:00:00.000Z',
    reasoning: 'bullish momentum',
  } as never)
  db.strategy_results.push({
    kind: 'demo_llm_trade',
    id: 'llm_trade_buy_1',
    symbol: 'ADAUSDT',
    side: 'BUY',
    price: 0.4,
    quantity: 50,
    notionalQuote: 20,
    reasoning: 'entry',
    createdAt: '2026-01-08T00:00:00.000Z',
  } as never)
  db.strategy_results.push({
    kind: 'demo_llm_trade',
    id: 'llm_trade_sell_1',
    symbol: 'ADAUSDT',
    side: 'SELL',
    price: 0.45,
    quantity: 50,
    notionalQuote: 22.5,
    pnlQuote: 2.5,
    reasoning: 'exit',
    createdAt: '2026-01-09T00:00:00.000Z',
  } as never)

  // Rebalance: one executed order.
  db.strategy_results.push({
    kind: 'demo_rebalance_trade',
    id: 'rebalance_trade_1',
    symbol: 'BTCUSDT',
    side: 'SELL',
    notionalQuote: 15,
    quantity: 0.0003,
    price: 50_000,
    reason: 'drift threshold',
    createdAt: '2026-01-10T00:00:00.000Z',
  } as never)

  store.writeFinanceStore(db)
}

describe('buildLedgerRecords', () => {
  it('normalizes every engine into one flat, engine-neutral record shape', async () => {
    await seedAllEngines()
    const { buildLedgerRecords } = await import('./trading-ledger')
    const records = buildLedgerRecords()

    // 2 council + 2 grid (1 held level + 1 trade; the unheld level is
    // excluded) + 3 llm (1 position + 2 trades) + 1 rebalance = 8.
    expect(records).toHaveLength(8)
    expect(records.filter((r) => r.engine === 'council')).toHaveLength(2)
    expect(records.filter((r) => r.engine === 'grid')).toHaveLength(2)
    expect(records.filter((r) => r.engine === 'llm')).toHaveLength(3)
    expect(records.filter((r) => r.engine === 'rebalance')).toHaveLength(1)

    const councilOpen = records.find((r) => r.id === 'council:council_pos_1')
    expect(councilOpen).toMatchObject({
      status: 'open',
      symbol: 'BTCUSDT',
      strategy: 'sma_crossover',
      executionMode: 'testnet',
      side: 'BUY',
      quantity: 0.01,
      entryPrice: 50_000,
      entryQuote: 500,
      feesQuote: 0.5,
      realizedPnlQuote: null,
      sourceId: 'council_pos_1',
    })

    const councilClosed = records.find(
      (r) => r.id === 'council:council_trade_1',
    )
    expect(councilClosed).toMatchObject({
      status: 'closed',
      symbol: 'ETHUSDT',
      realizedPnlQuote: 10,
      entryPrice: 2_000,
      exitPrice: 2_100,
    })

    // Only the held grid level should appear as an open record.
    const gridOpen = records.filter(
      (r) => r.engine === 'grid' && r.status === 'open',
    )
    expect(gridOpen).toHaveLength(1)
    expect(gridOpen[0]).toMatchObject({
      symbol: 'SOLUSDT',
      strategy: 'grid-level-0',
      entryPrice: 150,
      entryQuote: 30,
      quantity: 30 / 150,
    })

    const llmBuy = records.find((r) => r.id === 'llm:llm_trade_buy_1')
    expect(llmBuy).toMatchObject({
      status: 'closed',
      side: 'BUY',
      entryPrice: 0.4,
      entryQuote: 20,
      exitPrice: null,
      executionMode: 'testnet',
    })

    const llmSell = records.find((r) => r.id === 'llm:llm_trade_sell_1')
    expect(llmSell).toMatchObject({
      status: 'closed',
      side: 'SELL',
      exitPrice: 0.45,
      exitQuote: 22.5,
      realizedPnlQuote: 2.5,
    })

    const rebalance = records.find((r) => r.id === 'rebalance:rebalance_trade_1')
    expect(rebalance).toMatchObject({
      status: 'closed',
      side: 'SELL',
      exitPrice: 50_000,
      exitQuote: 15,
      realizedPnlQuote: null,
      executionMode: 'testnet',
    })

    // Read-only guarantee: building the ledger must never write anything
    // back to the finance store.
    const store = await import('../server/finance-store')
    const after = store.readFinanceStore()
    expect(after.strategy_results).toHaveLength(8)
  })
})

describe('queryLedger', () => {
  it('filters by engine, status, symbol, strategy, executionMode, and side', async () => {
    await seedAllEngines()
    const { buildLedgerRecords, queryLedger } = await import('./trading-ledger')
    const all = buildLedgerRecords()
    const asOf = '2026-01-11T00:00:00.000Z'

    expect(queryLedger(all, { engine: 'grid' }, asOf).total).toBe(2)
    expect(queryLedger(all, { status: 'open' }, asOf).total).toBe(3)
    expect(queryLedger(all, { symbol: 'btcusdt' }, asOf).total).toBe(2)
    expect(queryLedger(all, { strategy: 'RSI_REVERSION' }, asOf).total).toBe(1)
    expect(queryLedger(all, { executionMode: 'paper' }, asOf).total).toBe(2) // grid's default paper mode
    expect(queryLedger(all, { side: 'SELL' }, asOf).total).toBe(2) // llm sell + rebalance sell
  })

  it('applies inclusive from/to date bounds, normalizing bare dates', async () => {
    await seedAllEngines()
    const { buildLedgerRecords, queryLedger } = await import('./trading-ledger')
    const all = buildLedgerRecords()
    const asOf = '2026-01-11T00:00:00.000Z'

    // council_trade_1 closes 2026-01-03; everything from that date forward
    // (by closedAt/openedAt) should be included, nothing before.
    const fromResult = queryLedger(all, { from: '2026-01-09' }, asOf)
    expect(fromResult.total).toBeGreaterThan(0)
    for (const record of fromResult.records) {
      expect(record.timestamp >= '2026-01-09T00:00:00.000Z').toBe(true)
    }

    const toResult = queryLedger(all, { to: '2026-01-03' }, asOf)
    for (const record of toResult.records) {
      expect(record.timestamp <= '2026-01-03T23:59:59.999Z').toBe(true)
    }
  })

  it('paginates with bounded, clamped page/pageSize and reports hasMore/total', async () => {
    await seedAllEngines()
    const { buildLedgerRecords, queryLedger } = await import('./trading-ledger')
    const all = buildLedgerRecords()
    const asOf = '2026-01-11T00:00:00.000Z'

    const page1 = queryLedger(all, { page: 1, pageSize: 3 }, asOf)
    expect(page1.records).toHaveLength(3)
    expect(page1.total).toBe(8)
    expect(page1.hasMore).toBe(true)
    expect(page1.pageSize).toBe(3)

    const page3 = queryLedger(all, { page: 3, pageSize: 3 }, asOf)
    expect(page3.records).toHaveLength(2)
    expect(page3.hasMore).toBe(false)

    // Bounded: an absurd pageSize is clamped down, not honoured verbatim.
    const oversized = queryLedger(all, { pageSize: 999_999 }, asOf)
    expect(oversized.pageSize).toBeLessThanOrEqual(500)

    // Invalid/negative page falls back to page 1 rather than throwing.
    const invalidPage = queryLedger(all, { page: -5 }, asOf)
    expect(invalidPage.page).toBe(1)
  })

  it('sorts stably: descending by timestamp by default, ascending on request', async () => {
    await seedAllEngines()
    const { buildLedgerRecords, queryLedger } = await import('./trading-ledger')
    const all = buildLedgerRecords()
    const asOf = '2026-01-11T00:00:00.000Z'

    const desc = queryLedger(all, { pageSize: 100 }, asOf).records
    const timestamps = desc.map((r) => r.timestamp)
    const sortedDesc = [...timestamps].sort().reverse()
    expect(timestamps).toEqual(sortedDesc)

    const asc = queryLedger(
      all,
      { pageSize: 100, sort: 'timestamp_asc' },
      asOf,
    ).records
    expect(asc.map((r) => r.timestamp)).toEqual([...timestamps].reverse())
  })

  it('computes per-engine counts ignoring the engine filter itself', async () => {
    await seedAllEngines()
    const { buildLedgerRecords, queryLedger } = await import('./trading-ledger')
    const all = buildLedgerRecords()
    const asOf = '2026-01-11T00:00:00.000Z'

    const result = queryLedger(all, { engine: 'llm' }, asOf)
    // The page itself is filtered to just llm...
    expect(result.records.every((r) => r.engine === 'llm')).toBe(true)
    // ...but counts still reflect the full breakdown across all engines.
    expect(result.counts).toEqual({
      council: 2,
      grid: 2,
      llm: 3,
      rebalance: 1,
    })
  })
})

describe('renderLedgerCsv', () => {
  it('escapes commas, quotes, and newlines per RFC 4180 and stays bounded to the given records', async () => {
    const { renderLedgerCsv } = await import('./trading-ledger')
    const csv = renderLedgerCsv([
      {
        id: 'council:1',
        engine: 'council',
        status: 'closed',
        symbol: 'BTCUSDT',
        strategy: 'note, with a comma',
        executionMode: 'testnet',
        side: 'BUY',
        openedAt: '2026-01-01T00:00:00.000Z',
        closedAt: '2026-01-02T00:00:00.000Z',
        timestamp: '2026-01-02T00:00:00.000Z',
        quantity: 1,
        entryPrice: 100,
        exitPrice: 110,
        entryQuote: 100,
        exitQuote: 110,
        feesQuote: 0.1,
        realizedPnlQuote: 10,
        unrealizedPnlQuote: null,
        sourceId: 'trade "one"\nline two',
      },
    ])
    const lines = csv.trim().split('\r\n')
    expect(lines).toHaveLength(2) // header + one record
    expect(lines[0]).toBe(
      'id,engine,status,symbol,strategy,executionMode,side,openedAt,closedAt,quantity,entryPrice,exitPrice,entryQuote,exitQuote,feesQuote,realizedPnlQuote,unrealizedPnlQuote,sourceId',
    )
    expect(lines[1]).toContain('"note, with a comma"')
    expect(lines[1]).toContain('"trade ""one""\nline two"')
    // null fields render as empty, not the literal string "null".
    expect(lines[1]).not.toContain('null')
  })

  it('renders an empty ledger as just the header row', async () => {
    const { renderLedgerCsv } = await import('./trading-ledger')
    const csv = renderLedgerCsv([])
    expect(csv.trim().split('\r\n')).toHaveLength(1)
  })
})
