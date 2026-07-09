import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildContextSummary,
  buildPrompt,
  parseLlmResponse,
} from './llm-signal-engine'
import type { Candle } from './trading-strategies'

let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-signal-engine-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

const HOUR = 60 * 60_000
const BASE = Date.parse('2026-01-01T00:00:00.000Z')

function candle(i: number, close: number): Candle {
  return { openTime: BASE + i * HOUR, open: close, high: close + 1, low: close - 1, close, volume: 1 }
}

async function setMode(mode: string) {
  const store = await import('./finance-store')
  const db = store.readFinanceStore()
  db.settings.tradingMode = mode as never
  db.settings.emergencyKillSwitch = false
  store.writeFinanceStore(db)
}

// enabled defaults to false (see LlmSignalConfig.enabled's docstring) — the
// engine shares the council's global tradingMode, so this is its own
// distinct arming flag. Tests exercising a real cycle must opt in explicitly.
async function enableEngine() {
  const store = await import('./finance-store')
  const db = store.readFinanceStore()
  db.settings.demoTradingLlm = { enabled: true } as never
  store.writeFinanceStore(db)
}

describe('buildContextSummary', () => {
  it('computes indicator fields from candle history', () => {
    const candles = Array.from({ length: 60 }, (_, i) => candle(i, 100 + i * 0.1))
    const ctx = buildContextSummary('BTCUSDT', candles)
    expect(ctx.symbol).toBe('BTCUSDT')
    expect(ctx.lastPrice).toBe(candles[59].close)
    expect(ctx.sma20).not.toBeNull()
    expect(ctx.sma50).not.toBeNull()
    expect(ctx.rsi14).not.toBeNull()
    expect(ctx.atr14).not.toBeNull()
    expect(ctx.periodChangePct).toBeGreaterThan(0)
  })
})

describe('buildPrompt', () => {
  it('embeds context and open positions as JSON and asks for strict JSON back', () => {
    const prompt = buildPrompt(
      [{ symbol: 'BTCUSDT', lastPrice: 100, periodChangePct: 1, sma20: 99, sma50: 98, rsi14: 55, atr14: 1, candleCount: 60 }],
      [{ symbol: 'ETHUSDT', entryPrice: 2000 }],
    )
    expect(prompt).toContain('STRICT JSON')
    expect(prompt).toContain('BTCUSDT')
    expect(prompt).toContain('ETHUSDT')
  })
})

describe('parseLlmResponse', () => {
  it('parses a valid decision', () => {
    const d = parseLlmResponse('{"symbol":"BTCUSDT","signal":"BUY","confidence":0.8,"reasoning":"trend up"}')
    expect(d).toEqual({ signal: 'BUY', confidence: 0.8, reasoning: 'trend up' })
  })

  it('strips markdown code fences before parsing', () => {
    const d = parseLlmResponse('```json\n{"signal":"HOLD","confidence":0.5,"reasoning":"wait"}\n```')
    expect(d?.signal).toBe('HOLD')
  })

  it('returns null for unparseable content', () => {
    expect(parseLlmResponse('not json at all')).toBeNull()
  })

  it('returns null for a missing/invalid signal field', () => {
    expect(parseLlmResponse('{"confidence":0.8}')).toBeNull()
    expect(parseLlmResponse('{"signal":"MAYBE","confidence":0.8}')).toBeNull()
  })

  it('clamps confidence into [0, 1]', () => {
    expect(parseLlmResponse('{"signal":"BUY","confidence":5,"reasoning":""}')?.confidence).toBe(1)
    expect(parseLlmResponse('{"signal":"BUY","confidence":-2,"reasoning":""}')?.confidence).toBe(0)
  })

  it('defaults confidence to 0 and reasoning to empty string when absent', () => {
    const d = parseLlmResponse('{"signal":"HOLD"}')
    expect(d).toEqual({ signal: 'HOLD', confidence: 0, reasoning: '' })
  })
})

describe('runLlmSignalCycle gating', () => {
  it('does not run when tradingMode is not testnet_execute', async () => {
    await setMode('paper_trade')
    const { runLlmSignalCycle } = await import('./llm-signal-engine')
    const result = await runLlmSignalCycle()
    expect(result.ran).toBe(false)
    expect(result.reason).toContain('not testnet_execute')
  })

  it('does not run when the kill switch is active', async () => {
    await setMode('testnet_execute')
    const store = await import('./finance-store')
    const db = store.readFinanceStore()
    db.settings.emergencyKillSwitch = true
    store.writeFinanceStore(db)
    const { runLlmSignalCycle } = await import('./llm-signal-engine')
    const result = await runLlmSignalCycle()
    expect(result.ran).toBe(false)
    expect(result.reason).toContain('kill switch')
  })

  it('does not run when the engine is disabled (the default, even in testnet_execute)', async () => {
    await setMode('testnet_execute')
    const { runLlmSignalCycle } = await import('./llm-signal-engine')
    const result = await runLlmSignalCycle()
    expect(result.ran).toBe(false)
    expect(result.reason).toContain('disabled')
  })

  it('serializes overlapping cycles — the second is rejected as busy', async () => {
    await setMode('testnet_execute')
    await enableEngine()
    const { runLlmSignalCycle } = await import('./llm-signal-engine')
    const fakeClient = {
      host: 'demo-api.binance.com',
      environment: 'testnet' as const,
      ping: async () => true,
      getPrice: async () => 100,
      getKlines: async () => Array.from({ length: 60 }, (_, i) => candle(i, 100)),
      getAccount: async () => ({ accountType: 'SPOT', canTrade: true, balances: [] }),
      placeOrder: async () => ({
        symbol: 'BTCUSDT', orderId: 1, status: 'FILLED', side: 'BUY' as const, type: 'MARKET' as const,
        executedQty: 0.1, cummulativeQuoteQty: 10, fills: [], transactTime: Date.now(), avgPrice: 100,
      }),
    }
    const slowCallModel = async () =>
      new Promise<{ content: string; model: string } | null>((resolve) =>
        setTimeout(() => resolve({ content: '{"signal":"HOLD","confidence":0.5,"reasoning":"x"}', model: 'test' }), 20),
      )
    const [a, b] = await Promise.all([
      runLlmSignalCycle({ client: fakeClient as never, callModel: slowCallModel }),
      runLlmSignalCycle({ client: fakeClient as never, callModel: slowCallModel }),
    ])
    const busy = [a, b].filter((r) => !r.ran && r.reason === 'already in progress')
    expect(busy).toHaveLength(1)
  })

  it('opens a real position on a high-confidence BUY decision', async () => {
    await setMode('testnet_execute')
    await enableEngine()
    const { runLlmSignalCycle, getLlmSignalState } = await import('./llm-signal-engine')
    const fakeClient = {
      host: 'demo-api.binance.com',
      environment: 'testnet' as const,
      ping: async () => true,
      getPrice: async () => 100,
      getKlines: async () => Array.from({ length: 60 }, (_, i) => candle(i, 100)),
      getAccount: async () => ({ accountType: 'SPOT', canTrade: true, balances: [] }),
      placeOrder: async () => ({
        symbol: 'BTCUSDT', orderId: 1, status: 'FILLED', side: 'BUY' as const, type: 'MARKET' as const,
        executedQty: 0.1, cummulativeQuoteQty: 10, fills: [], transactTime: Date.now(), avgPrice: 100,
      }),
    }
    const callModel = async () => ({
      content: '{"symbol":"BTCUSDT","signal":"BUY","confidence":0.9,"reasoning":"strong trend"}',
      model: 'test-model',
    })
    const result = await runLlmSignalCycle({ client: fakeClient as never, callModel })
    expect(result.ran).toBe(true)
    expect(result.trade?.side).toBe('BUY')
    expect(getLlmSignalState().positions).toHaveLength(1)
  })

  it('ignores a decision below the configured minimum confidence', async () => {
    await setMode('testnet_execute')
    await enableEngine()
    const { runLlmSignalCycle, getLlmSignalState } = await import('./llm-signal-engine')
    const fakeClient = {
      host: 'demo-api.binance.com',
      environment: 'testnet' as const,
      ping: async () => true,
      getPrice: async () => 100,
      getKlines: async () => Array.from({ length: 60 }, (_, i) => candle(i, 100)),
      getAccount: async () => ({ accountType: 'SPOT', canTrade: true, balances: [] }),
      placeOrder: async () => {
        throw new Error('should not place an order below min confidence')
      },
    }
    const callModel = async () => ({
      content: '{"symbol":"BTCUSDT","signal":"BUY","confidence":0.1,"reasoning":"weak"}',
      model: 'test-model',
    })
    const result = await runLlmSignalCycle({ client: fakeClient as never, callModel })
    expect(result.ran).toBe(true)
    expect(result.trade).toBeUndefined()
    expect(getLlmSignalState().positions).toHaveLength(0)
  })
})
