import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Same isolation pattern as demo-trading-engine.test.ts / llm-signal-engine.test.ts —
// point HOME at a temp dir so readFinanceStore/writeFinanceStore never touch
// the real ~/.hermes/finance store, and reset modules so it re-evaluates.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-refinement-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function seedRows(rows: Array<Record<string, unknown>>) {
  const store = await import('./finance-store')
  const db = store.readFinanceStore()
  db.strategy_results = rows as any
  store.writeFinanceStore(db)
}

function gridTrade(id: string, pnlQuote: number) {
  return {
    kind: 'demo_grid_trade',
    id,
    symbol: 'BTCUSDT',
    levelIndex: 0,
    entryPrice: 100,
    exitPrice: 100 + pnlQuote,
    quantity: 1,
    entryQuote: 100,
    exitQuote: 100 + pnlQuote,
    pnlQuote,
    feesQuote: 0,
    reason: 'grid-fill',
    openedAt: new Date().toISOString(),
    closedAt: new Date().toISOString(),
  }
}

function rebalanceTrade(id: string, notionalQuote: number) {
  return {
    kind: 'demo_rebalance_trade',
    id,
    symbol: 'BTCUSDT',
    side: 'BUY',
    notionalQuote,
    quantity: notionalQuote / 100,
    price: 100,
    reason: 'drift',
    createdAt: new Date().toISOString(),
  }
}

function llmTrade(id: string, pnlQuote: number) {
  return {
    kind: 'demo_llm_trade',
    id,
    symbol: 'BTCUSDT',
    side: 'SELL',
    price: 100,
    quantity: 0.1,
    notionalQuote: 10,
    pnlQuote,
    reasoning: 'test',
    createdAt: new Date().toISOString(),
  }
}

describe('evaluateAllCandidates', () => {
  it('returns nothing when there is not enough evidence for any engine', async () => {
    const { evaluateAllCandidates } = await import('./auto-refinement')
    expect(evaluateAllCandidates()).toEqual([])
  })

  it('proposes a smaller quotePerGrid when recent grid trades are net negative', async () => {
    await seedRows(Array.from({ length: 10 }, (_, i) => gridTrade(`g${i}`, -1)))
    const { evaluateAllCandidates } = await import('./auto-refinement')
    const candidates = evaluateAllCandidates()
    const grid = candidates.find((c) => c.engine === 'grid')
    expect(grid).toBeDefined()
    expect(grid?.paramName).toBe('quotePerGrid')
    expect(grid?.newValue).toBeLessThan(grid!.oldValue)
    expect(grid?.riskDirection).toBe('reducing')
  })

  it('does not propose a grid change when recent trades are net positive', async () => {
    await seedRows(Array.from({ length: 10 }, (_, i) => gridTrade(`g${i}`, 1)))
    const { evaluateAllCandidates } = await import('./auto-refinement')
    expect(
      evaluateAllCandidates().find((c) => c.engine === 'grid'),
    ).toBeUndefined()
  })

  it('proposes a higher minTradeNotionalQuote when most rebalance trades sit near the floor', async () => {
    await seedRows(
      Array.from({ length: 10 }, (_, i) => rebalanceTrade(`r${i}`, 5)),
    )
    const { evaluateAllCandidates } = await import('./auto-refinement')
    const rebalance = evaluateAllCandidates().find(
      (c) => c.engine === 'rebalance',
    )
    expect(rebalance).toBeDefined()
    expect(rebalance?.paramName).toBe('minTradeNotionalQuote')
    expect(rebalance?.newValue).toBeGreaterThan(rebalance!.oldValue)
    expect(rebalance?.riskDirection).toBe('reducing')
  })

  it('does not propose a rebalance change when trades are comfortably above the floor', async () => {
    await seedRows(
      Array.from({ length: 10 }, (_, i) => rebalanceTrade(`r${i}`, 100)),
    )
    const { evaluateAllCandidates } = await import('./auto-refinement')
    expect(
      evaluateAllCandidates().find((c) => c.engine === 'rebalance'),
    ).toBeUndefined()
  })

  it('proposes a higher minConfidence when closed LLM trades are net negative', async () => {
    await seedRows(Array.from({ length: 5 }, (_, i) => llmTrade(`l${i}`, -1)))
    const { evaluateAllCandidates } = await import('./auto-refinement')
    const llm = evaluateAllCandidates().find((c) => c.engine === 'llm_signal')
    expect(llm).toBeDefined()
    expect(llm?.paramName).toBe('minConfidence')
    expect(llm?.newValue).toBeGreaterThan(llm!.oldValue)
    expect(llm?.riskDirection).toBe('reducing')
  })

  it('does not propose an LLM change when closed trades are net positive', async () => {
    await seedRows(Array.from({ length: 5 }, (_, i) => llmTrade(`l${i}`, 1)))
    const { evaluateAllCandidates } = await import('./auto-refinement')
    expect(
      evaluateAllCandidates().find((c) => c.engine === 'llm_signal'),
    ).toBeUndefined()
  })
})

describe('runAutoRefinementCycle', () => {
  it('records candidates but does not mutate engine settings while the policy is disabled (default)', async () => {
    await seedRows(Array.from({ length: 10 }, (_, i) => gridTrade(`g${i}`, -1)))
    const store = await import('./finance-store')
    const { runAutoRefinementCycle } = await import('./auto-refinement')
    const result = await runAutoRefinementCycle()
    expect(result.policyEnabled).toBe(false)
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.applied).toEqual([])
    const db = store.readFinanceStore()
    expect((db.settings.demoTradingGrid as any)?.quotePerGrid).toBeUndefined()
  })

  it('applies candidates directly to each engine settings key once the policy is enabled', async () => {
    await seedRows(Array.from({ length: 10 }, (_, i) => gridTrade(`g${i}`, -1)))
    const store = await import('./finance-store')
    const db0 = store.readFinanceStore()
    db0.settings.autoRefinement = { enabled: true } as any
    store.writeFinanceStore(db0)
    const { runAutoRefinementCycle } = await import('./auto-refinement')
    const result = await runAutoRefinementCycle()
    expect(result.policyEnabled).toBe(true)
    expect(result.applied.length).toBeGreaterThan(0)
    const db1 = store.readFinanceStore()
    const grid = result.applied.find((c) => c.engine === 'grid')
    if (grid) {
      expect((db1.settings.demoTradingGrid as any).quotePerGrid).toBe(
        grid.newValue,
      )
    }
  })
})

describe('resolveAutoRefinementPolicy', () => {
  it('defaults to disabled', async () => {
    const { resolveAutoRefinementPolicy } = await import('./auto-refinement')
    expect(resolveAutoRefinementPolicy(undefined)).toEqual({ enabled: false })
  })
})
