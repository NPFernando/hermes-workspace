import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

// The finance store resolves its path from os.homedir() (which honours $HOME
// on POSIX) at module load, so point HOME at a temp dir and reset modules so
// the store re-evaluates against it — never touch the real ~/.hermes/finance.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-engine-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

function fakeClient(overrides: Partial<any> = {}) {
  return {
    host: 'demo-api.binance.com',
    ping: async () => true,
    getPrice: async () => 100,
    getKlines: async () => steadyDowntrend(),
    getAccount: async () => ({ accountType: 'SPOT', canTrade: true, balances: [{ asset: 'USDT', free: 5000, locked: 0 }] }),
    placeOrder: async (o: any) => ({
      symbol: o.symbol,
      orderId: Math.floor(Math.random() * 1e6),
      status: 'FILLED',
      side: o.side,
      type: o.type,
      executedQty: o.side === 'BUY' ? 0.25 : 0.25,
      cummulativeQuoteQty: o.side === 'BUY' ? (o.quoteOrderQty ?? 25) : 30, // sell returns more → profit
      fills: [],
      transactTime: Date.now(),
      avgPrice: o.side === 'BUY' ? 100 : 120,
    }),
    ...overrides,
  }
}

// Steady decline → RSI oversold → BUY from the RSI strategy.
function steadyDowntrend() {
  const closes = Array.from({ length: 31 }, (_, i) => 100 - i * 1.5)
  return closes.map((c, i) => ({ openTime: i, open: c, high: c, low: c, close: c, volume: 1 }))
}

async function setMode(mode: string) {
  const store = await import('./finance-store')
  const db = store.readFinanceStore()
  db.settings.tradingMode = mode as never
  db.settings.emergencyKillSwitch = false
  store.writeFinanceStore(db)
}

describe('runTradingCycle gating', () => {
  it('does not run when tradingMode is not testnet_execute', async () => {
    await setMode('observe_only')
    const { runTradingCycle } = await import('./demo-trading-engine')
    const res = await runTradingCycle({ client: fakeClient() as never })
    expect(res.ran).toBe(false)
    expect(res.reason).toMatch(/testnet_execute/)
  })

  it('halts when the kill switch is active', async () => {
    const store = await import('./finance-store')
    const db = store.readFinanceStore()
    db.settings.tradingMode = 'testnet_execute' as never
    db.settings.emergencyKillSwitch = true
    store.writeFinanceStore(db)
    const { runTradingCycle } = await import('./demo-trading-engine')
    const res = await runTradingCycle({ client: fakeClient() as never })
    expect(res.ran).toBe(false)
    expect(res.reason).toMatch(/kill switch/)
  })

  it('force runs regardless of mode', async () => {
    await setMode('observe_only')
    const { runTradingCycle } = await import('./demo-trading-engine')
    const res = await runTradingCycle({ client: fakeClient() as never, force: true, config: { symbols: ['BTCUSDT'], enabledStrategies: ['rsi_reversion'] } })
    expect(res.ran).toBe(true)
  })
})

describe('runTradingCycle open → close → score', () => {
  it('opens a position on a BUY signal, then closes with profit and scores it', async () => {
    await setMode('testnet_execute')
    const { runTradingCycle, getEngineState } = await import('./demo-trading-engine')

    // Isolate the RSI strategy so the council reduces to one clear voter.
    const cfg = { symbols: ['BTCUSDT'], enabledStrategies: ['rsi_reversion'] }

    // Cycle 1: flat → council BUY (RSI oversold) → guardian OK → OPEN.
    const r1 = await runTradingCycle({ client: fakeClient() as never, config: cfg })
    expect(r1.ran).toBe(true)
    expect(r1.actions.some((a) => a.action === 'OPEN')).toBe(true)
    expect(getEngineState().positions.length).toBe(1)

    // Cycle 2: price now well above entry (take-profit) → should CLOSE with positive PnL.
    const highClient = fakeClient({
      getKlines: async () => Array.from({ length: 31 }, (_, i) => ({ openTime: i, open: 130, high: 130, low: 130, close: 130, volume: 1 })),
    })
    const r2 = await runTradingCycle({ client: highClient as never, config: cfg })
    const close = r2.actions.find((a) => a.action === 'CLOSE')
    expect(close).toBeTruthy()
    expect(close!.pnlQuote).toBeGreaterThan(0)
    const state = getEngineState()
    expect(state.positions.length).toBe(0)
    const scored = state.scores.find((s) => s.trades > 0)
    expect(scored).toBeTruthy()
    expect(scored!.wins).toBe(1)
    expect(scored!.score).toBeGreaterThan(0)
  })
})

describe('runTradingCycle concurrency', () => {
  it('serializes overlapping cycles — the second is rejected as busy', async () => {
    await setMode('testnet_execute')
    const { runTradingCycle } = await import('./demo-trading-engine')
    const cfg = { symbols: ['BTCUSDT'], enabledStrategies: ['rsi_reversion'] }
    const [a, b] = await Promise.all([
      runTradingCycle({ client: fakeClient() as never, config: cfg }),
      runTradingCycle({ client: fakeClient() as never, config: cfg }),
    ])
    const busy = [a, b].filter((r) => !r.ran && /already in progress/.test(r.reason ?? ''))
    expect(busy).toHaveLength(1)
  })
})
