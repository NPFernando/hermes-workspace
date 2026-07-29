import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  DEFAULT_REBALANCE_CONFIG,
  buildTradePlan,
  equalTargetWeights,
  maxDrift,
  planRebalance,
} from './rebalance-engine'

// Same isolation pattern as demo-trading-engine.test.ts / llm-signal-engine.test.ts —
// point HOME at a temp dir so readFinanceStore/writeFinanceStore never touch
// the real ~/.hermes/finance store. Only needed for the gating describe block
// below; the pure-function tests above don't touch the finance store at all.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rebalance-engine-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function setMode(mode: string) {
  const store = await import('./finance-store')
  const db = store.readFinanceStore()
  db.settings.tradingMode = mode as never
  db.settings.emergencyKillSwitch = false
  store.writeFinanceStore(db)
}

// enabled defaults to false (see RebalanceConfig.enabled's docstring) — the
// engine shares the council's global tradingMode, so this is its own
// distinct arming flag. Tests exercising a real cycle must opt in explicitly.
async function enableEngine() {
  const store = await import('./finance-store')
  const db = store.readFinanceStore()
  db.settings.demoTradingRebalance = { enabled: true } as never
  store.writeFinanceStore(db)
}

function fakeClient(balances: Array<{ asset: string; free: number }>) {
  return {
    host: 'demo-api.binance.com',
    environment: 'testnet' as const,
    ping: async () => true,
    getPrice: async () => 100,
    getKlines: async () => [],
    getAccount: async () => ({ accountType: 'SPOT', canTrade: true, balances }),
    placeOrder: async (o: { symbol: string; side: 'BUY' | 'SELL'; quoteOrderQty?: number; quantity?: number }) => ({
      symbol: o.symbol,
      orderId: 1,
      status: 'FILLED' as const,
      side: o.side,
      type: 'MARKET' as const,
      executedQty: o.side === 'BUY' ? (o.quoteOrderQty ?? 0) / 100 : (o.quantity ?? 0),
      cummulativeQuoteQty: o.side === 'BUY' ? (o.quoteOrderQty ?? 0) : (o.quantity ?? 0) * 100,
      fills: [],
      transactTime: Date.now(),
      avgPrice: 100,
    }),
  }
}

describe('equalTargetWeights', () => {
  it('splits evenly across symbols', () => {
    const w = equalTargetWeights(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'])
    expect(w.BTCUSDT).toBeCloseTo(0.2, 10)
    expect(Object.values(w).reduce((s, v) => s + v, 0)).toBeCloseTo(1, 10)
  })
})

describe('planRebalance', () => {
  it('computes actual/target weights and diffs against total portfolio value including free quote', () => {
    const { totalValueQuote, items } = planRebalance(
      { BTCUSDT: 60, ETHUSDT: 20 },
      20, // free quote
      { BTCUSDT: 0.5, ETHUSDT: 0.5 },
    )
    expect(totalValueQuote).toBe(100)
    const btc = items.find((i) => i.symbol === 'BTCUSDT')!
    expect(btc.actualWeight).toBeCloseTo(0.6, 10)
    expect(btc.targetValueQuote).toBe(50)
    expect(btc.diffQuote).toBe(-10) // overweight, needs to sell 10
    const eth = items.find((i) => i.symbol === 'ETHUSDT')!
    expect(eth.diffQuote).toBe(30) // underweight, needs to buy 30
  })

  it('treats a zero-value portfolio as zero weight everywhere (no divide-by-zero)', () => {
    const { items } = planRebalance({ BTCUSDT: 0 }, 0, { BTCUSDT: 1 })
    expect(items[0]?.actualWeight).toBe(0)
  })
})

describe('maxDrift', () => {
  it('returns the largest absolute deviation from target', () => {
    const drift = maxDrift([
      { symbol: 'A', actualWeight: 0.6, targetWeight: 0.5, actualValueQuote: 0, targetValueQuote: 0, diffQuote: 0 },
      { symbol: 'B', actualWeight: 0.4, targetWeight: 0.5, actualValueQuote: 0, targetValueQuote: 0, diffQuote: 0 },
    ])
    expect(drift).toBeCloseTo(0.1, 10)
  })
})

describe('buildTradePlan', () => {
  it('orders sells before buys and skips trades below the minimum notional', () => {
    const plan = buildTradePlan(
      [
        { symbol: 'OVER', actualWeight: 0.6, targetWeight: 0.5, actualValueQuote: 60, targetValueQuote: 50, diffQuote: -10 },
        { symbol: 'UNDER', actualWeight: 0.4, targetWeight: 0.5, actualValueQuote: 40, targetValueQuote: 50, diffQuote: 10 },
        { symbol: 'TINY', actualWeight: 0.5, targetWeight: 0.5, actualValueQuote: 50.5, targetValueQuote: 50, diffQuote: -0.5 },
      ],
      { ...DEFAULT_REBALANCE_CONFIG, maxNotionalPerCycleQuote: 1000, minTradeNotionalQuote: 5 },
    )
    expect(plan.map((p) => p.symbol)).toEqual(['OVER', 'UNDER'])
    expect(plan[0]?.side).toBe('SELL')
    expect(plan[1]?.side).toBe('BUY')
  })

  it('stops adding trades once the per-cycle notional cap is reached', () => {
    const plan = buildTradePlan(
      [
        { symbol: 'A', actualWeight: 0, targetWeight: 0, actualValueQuote: 0, targetValueQuote: 0, diffQuote: 60 },
        { symbol: 'B', actualWeight: 0, targetWeight: 0, actualValueQuote: 0, targetValueQuote: 0, diffQuote: 60 },
      ],
      { ...DEFAULT_REBALANCE_CONFIG, maxNotionalPerCycleQuote: 100, minTradeNotionalQuote: 5 },
    )
    const totalNotional = plan.reduce((s, p) => s + p.notionalQuote, 0)
    expect(totalNotional).toBeLessThanOrEqual(100)
  })
})

describe('runRebalanceCycle gating', () => {
  it('does not run when tradingMode is not testnet_execute', async () => {
    await setMode('paper_trade')
    await enableEngine()
    const { runRebalanceCycle } = await import('./rebalance-engine')
    const result = await runRebalanceCycle()
    expect(result.ran).toBe(false)
    expect(result.reason).toContain('not testnet_execute')
  })

  it('does not run when the kill switch is active', async () => {
    await setMode('testnet_execute')
    await enableEngine()
    const store = await import('./finance-store')
    const db = store.readFinanceStore()
    db.settings.emergencyKillSwitch = true
    store.writeFinanceStore(db)
    const { runRebalanceCycle } = await import('./rebalance-engine')
    const result = await runRebalanceCycle()
    expect(result.ran).toBe(false)
    expect(result.reason).toContain('kill switch')
  })

  it('does not run when the engine is disabled (the default, even in testnet_execute)', async () => {
    await setMode('testnet_execute')
    const { runRebalanceCycle } = await import('./rebalance-engine')
    const result = await runRebalanceCycle()
    expect(result.ran).toBe(false)
    expect(result.reason).toContain('disabled')
  })

  it('does not run when the connectivity breaker is tripped', async () => {
    await setMode('testnet_execute')
    await enableEngine()
    const { recordConnectivityOutcome } = await import('./connectivity-breaker')
    const CRED_FAILURE = 'Binance demo /api/v3/order failed (401): Unauthorized'
    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(CRED_FAILURE)
    const { runRebalanceCycle } = await import('./rebalance-engine')
    const result = await runRebalanceCycle()
    expect(result.ran).toBe(false)
    expect(result.reason).toContain('connectivity breaker')
  })

  it('executes trades once enabled, in testnet_execute, and drift exceeds the threshold', async () => {
    await setMode('testnet_execute')
    await enableEngine()
    const { runRebalanceCycle, getRebalanceState } = await import('./rebalance-engine')
    // All-USDT, no crypto holdings — 100% drift from equal-weight target on every symbol.
    const client = fakeClient([{ asset: 'USDT', free: 1000 }])
    const result = await runRebalanceCycle({ client: client as never })
    expect(result.ran).toBe(true)
    expect(result.trades.length).toBeGreaterThan(0)
    expect(getRebalanceState().trades.length).toBeGreaterThan(0)
  })
})
