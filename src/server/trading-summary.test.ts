import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Same isolation pattern as rebalance-engine.test.ts / llm-signal-engine.test.ts —
// point HOME at a temp dir so readFinanceStore never touches the real
// ~/.hermes/finance store.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-summary-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('getTradingSummary', () => {
  it('aggregates a clean store without throwing, with sane defaults', async () => {
    const { getTradingSummary } = await import('./trading-summary')
    const summary = getTradingSummary()

    expect(summary.tradingMode).toBe('observe_only')
    expect(summary.emergencyKillSwitch).toBe(true) // finance-store's own default
    expect(summary.todayPnlQuote).toBe(0)
    expect(summary.totalPnlQuote).toBe(0)
    expect(summary.openPositions).toBe(0)
    expect(summary.engines).toHaveLength(4)
    expect(summary.engines.map((e) => e.id)).toEqual(['council', 'grid', 'rebalance', 'llm'])
    // Kill switch is on by default — every engine should report disabled.
    for (const engine of summary.engines) {
      expect(engine.armState).toBe('disabled')
      expect(engine.reason).toMatch(/kill switch/)
    }
  })

  it('reports rebalance/llm as gated (not disabled) once armed but tradingMode is paper', async () => {
    const store = await import('./finance-store')
    const db = store.readFinanceStore()
    db.settings.emergencyKillSwitch = false
    db.settings.tradingMode = 'paper_trade' as never
    db.settings.demoTradingRebalance = { enabled: true } as never
    db.settings.demoTradingLlm = { enabled: true } as never
    store.writeFinanceStore(db)

    const { getTradingSummary } = await import('./trading-summary')
    const summary = getTradingSummary()

    const rebalance = summary.engines.find((e) => e.id === 'rebalance')
    const llm = summary.engines.find((e) => e.id === 'llm')
    expect(rebalance?.armState).toBe('gated')
    expect(rebalance?.reason).toMatch(/testnet_execute/)
    expect(llm?.armState).toBe('gated')
    expect(llm?.reason).toMatch(/testnet_execute/)

    const council = summary.engines.find((e) => e.id === 'council')
    const grid = summary.engines.find((e) => e.id === 'grid')
    expect(council?.armState).toBe('paper')
    expect(grid?.armState).toBe('paper')
  })

  it('keeps grid on paper when tradingMode is testnet_execute but its own executionMode is not', async () => {
    // Regression test: grid has its own independent settings.demoTradingGrid
    // .executionMode, checked in addition to the global tradingMode by
    // grid-paper-engine.ts's own gate — this must never show "live" (or
    // actually arm) just because the global tradingMode flipped for other
    // engines. Council, which has no such independent flag, correctly does
    // go live in this same scenario.
    const store = await import('./finance-store')
    const db = store.readFinanceStore()
    db.settings.emergencyKillSwitch = false
    db.settings.tradingMode = 'testnet_execute' as never
    db.settings.demoTradingGrid = { executionMode: 'paper' } as never
    store.writeFinanceStore(db)

    const { getTradingSummary } = await import('./trading-summary')
    const summary = getTradingSummary()

    const grid = summary.engines.find((e) => e.id === 'grid')
    expect(grid?.armState).toBe('paper')
    expect(grid?.reason).toMatch(/executionMode/)

    const council = summary.engines.find((e) => e.id === 'council')
    expect(council?.armState).toBe('live')
  })
})
