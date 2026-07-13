import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  DEFAULT_GRID_ENGINE_CONFIG,
  advanceSymbolState,
} from './grid-paper-engine'
import type { GridEngineConfig, GridSymbolState } from './grid-paper-engine'
import type { Candle } from './trading-strategies'

// Same sandbox pattern as demo-trading-engine.test.ts: point the finance
// store at a temp HOME so tests never touch ~/.hermes/finance.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grid-paper-engine-'))
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

function candle(
  index: number,
  vals: { open: number; high: number; low: number; close: number },
): Candle {
  return {
    openTime: BASE + index * HOUR,
    open: vals.open,
    high: vals.high,
    low: vals.low,
    close: vals.close,
    volume: 1,
  }
}

function flat(index: number, price: number, spread = 0): Candle {
  return candle(index, {
    open: price,
    high: price + spread,
    low: price - spread,
    close: price,
  })
}

function cfg(overrides: Partial<GridEngineConfig> = {}): GridEngineConfig {
  return { ...DEFAULT_GRID_ENGINE_CONFIG, ...overrides }
}

/** Strips fields that legitimately differ per call (id, timestamps) for economic comparison. */
function economicShape(trades: Array<{ entryPrice: number; exitPrice: number; reason: string; pnlQuote: number }>) {
  return trades
    .map((t) => ({
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      reason: t.reason,
      pnlQuote: Number(t.pnlQuote.toFixed(8)),
    }))
    .sort((a, b) => a.entryPrice - b.entryPrice || a.exitPrice - b.exitPrice)
}

describe('advanceSymbolState — cold start', () => {
  it('arms from a warmup window and fills on a subsequent sweep', () => {
    const candles: Array<Candle> = []
    for (let i = 0; i < 5; i++) candles.push(candle(i, { open: 100, high: 110, low: 90, close: 100 }))
    candles.push(candle(5, { open: 92, high: 95, low: 85, close: 90 }))
    candles.push(candle(6, { open: 98, high: 105, low: 95, close: 100 }))

    const { state, trades } = advanceSymbolState(
      'BTCUSDT',
      undefined,
      candles,
      cfg({ rangeLookbackCandles: 5, gridCount: 3, spacing: 'arithmetic', efficiencyGate: false }),
    )

    expect(state.armed).toBe(true)
    expect(state.lastProcessedOpenTime).toBe(candles[6].openTime)
    const fills = trades.filter((t) => t.reason === 'grid-fill')
    expect(fills).toHaveLength(1)
    expect(fills[0].entryPrice).toBe(90)
    expect(fills[0].exitPrice).toBe(100)
    expect(fills[0].pnlQuote).toBeGreaterThan(0)
  })
})

describe('advanceSymbolState — incremental correctness', () => {
  it('produces the same economic result across two calls as one continuous call', () => {
    const candles: Array<Candle> = []
    for (let i = 0; i < 5; i++) candles.push(candle(i, { open: 100, high: 110, low: 90, close: 100 }))
    candles.push(candle(5, { open: 92, high: 95, low: 85, close: 90 })) // fills level 90
    for (let i = 6; i < 9; i++) candles.push(flat(i, 92, 1))
    candles.push(candle(9, { open: 98, high: 105, low: 95, close: 100 })) // sells at 100
    for (let i = 10; i < 13; i++) candles.push(flat(i, 99, 1))

    const config = cfg({
      rangeLookbackCandles: 5,
      gridCount: 3,
      spacing: 'arithmetic',
      efficiencyGate: false,
    })

    const oneShot = advanceSymbolState('BTCUSDT', undefined, candles, config)

    // Split the same history into two "cron cycles": first sees only the
    // first 9 candles, second sees the full history (as a live fetch would
    // — a generous trailing window that includes already-processed candles).
    const firstCycle = advanceSymbolState('BTCUSDT', undefined, candles.slice(0, 9), config)
    const secondCycle = advanceSymbolState('BTCUSDT', firstCycle.state, candles, config)
    const combinedTrades = [...firstCycle.trades, ...secondCycle.trades]

    expect(economicShape(combinedTrades)).toEqual(economicShape(oneShot.trades))
    expect(secondCycle.state.lastProcessedOpenTime).toBe(oneShot.state.lastProcessedOpenTime)
    expect(secondCycle.state.armed).toBe(oneShot.state.armed)
  })

  it('does nothing when a cycle sees no candles newer than lastProcessedOpenTime', () => {
    const candles: Array<Candle> = []
    for (let i = 0; i < 5; i++) candles.push(candle(i, { open: 100, high: 110, low: 90, close: 100 }))
    candles.push(candle(5, { open: 92, high: 95, low: 85, close: 90 }))

    const config = cfg({ rangeLookbackCandles: 5, gridCount: 3, spacing: 'arithmetic', efficiencyGate: false })
    const first = advanceSymbolState('BTCUSDT', undefined, candles, config)
    // Re-run with the exact same candle set — nothing new to process.
    const second = advanceSymbolState('BTCUSDT', first.state, candles, config)

    expect(second.trades).toHaveLength(0)
    expect(second.state).toEqual({ ...first.state, updatedAt: second.state.updatedAt })
  })
})

describe('advanceSymbolState — efficiency gate persists across calls', () => {
  it('pauses on a trending window in one call and resumes in a later call', () => {
    const config = cfg({
      rangeLookbackCandles: 5,
      gridCount: 3,
      spacing: 'arithmetic',
      efficiencyGate: true,
      efficiencyLookbackCandles: 3,
      maxEfficiencyRatio: 0.3,
    })

    // Seed an already-armed state with one held level directly — this test
    // is about pause/resume persisting across incremental calls, not about
    // re-proving the arming/fill mechanics the other tests already cover.
    const seeded: GridSymbolState = {
      kind: 'demo_grid_state',
      symbol: 'BTCUSDT',
      armed: true,
      halted: false,
      pausedForChop: false,
      lower: 99,
      upper: 101,
      levels: [
        {
          price: 99,
          held: true,
          entryPrice: 99,
          entryQuote: 5,
          entryFeeQuote: 0.005,
          openedAt: new Date(BASE + 4 * HOUR).toISOString(),
        },
        { price: 100, held: false, entryPrice: 0, entryQuote: 0, entryFeeQuote: 0, openedAt: '' },
        { price: 101, held: false, entryPrice: 0, entryQuote: 0, entryFeeQuote: 0, openedAt: '' },
      ],
      lastProcessedOpenTime: BASE + 4 * HOUR,
      updatedAt: new Date(0).toISOString(),
    }

    // Calm lookback context (needed for the efficiency-ratio window at the
    // first trending candle), staying under the level-100 sell target so
    // the seeded position remains held.
    const candles: Array<Candle> = []
    for (let i = 5; i < 9; i++) candles.push(flat(i, 99, 0.5))
    // Genuine directional run in the closes.
    candles.push(candle(9, { open: 100, high: 112, low: 98, close: 110 }))
    candles.push(candle(10, { open: 110, high: 122, low: 108, close: 120 }))
    candles.push(candle(11, { open: 120, high: 132, low: 118, close: 130 }))
    candles.push(candle(12, { open: 130, high: 142, low: 128, close: 140 }))

    const firstCycle = advanceSymbolState('BTCUSDT', seeded, candles.slice(0, 4), config)
    expect(firstCycle.state.pausedForChop).toBe(false)
    expect(firstCycle.state.levels[0].held).toBe(true)

    // Second cycle sees the full history including the wide swing.
    const secondCycle = advanceSymbolState('BTCUSDT', firstCycle.state, candles, config)
    expect(secondCycle.state.pausedForChop).toBe(true)
    expect(secondCycle.trades.some((t) => t.reason === 'chop-pause-liquidation')).toBe(true)

    // Third cycle: calm again — should resume.
    const calmTail: Array<Candle> = []
    for (let i = 13; i < 20; i++) calmTail.push(flat(i, 99, 1))
    const thirdCycle = advanceSymbolState('BTCUSDT', secondCycle.state, [...candles, ...calmTail], config)
    expect(thirdCycle.state.pausedForChop).toBe(false)
  })
})

describe('advanceSymbolState — idle-range re-arm', () => {
  const seededHeld = (): GridSymbolState => ({
    kind: 'demo_grid_state',
    symbol: 'BTCUSDT',
    armed: true,
    halted: false,
    pausedForChop: false,
    lower: 90,
    upper: 110,
    levels: [
      {
        price: 90,
        held: true,
        entryPrice: 90,
        entryQuote: 5,
        entryFeeQuote: 0.005,
        openedAt: new Date(BASE + 4 * HOUR).toISOString(),
      },
      { price: 100, held: false, entryPrice: 0, entryQuote: 0, entryFeeQuote: 0, openedAt: '' },
      { price: 110, held: false, entryPrice: 0, entryQuote: 0, entryFeeQuote: 0, openedAt: '' },
    ],
    lastProcessedOpenTime: BASE + 4 * HOUR,
    updatedAt: new Date(0).toISOString(),
  })

  it('re-arms after N outside closes, with the streak persisting across calls', () => {
    const config = cfg({
      rangeLookbackCandles: 5,
      gridCount: 3,
      spacing: 'arithmetic',
      efficiencyGate: false,
      upperStopPct: 0.5,
      lowerStopPct: 0.5,
      autoRecenter: true,
      rearmOutsideRangeCandles: 3,
    })
    // Closes at 88 — below the 90 lower bound, nowhere near the 50% stops,
    // and never touching the 100 sell target, so the bag just sits.
    const candles: Array<Candle> = []
    for (let i = 5; i < 10; i++) candles.push(flat(i, 88, 1))

    // First cycle sees only two outside closes — streak persists, no re-arm yet.
    const first = advanceSymbolState('BTCUSDT', seededHeld(), candles.slice(0, 2), config)
    expect(first.trades).toHaveLength(0)
    expect(first.state.outsideRangeStreak).toBe(2)
    expect(first.state.levels[0].held).toBe(true)

    // Second cycle adds the third outside close — the re-arm fires.
    const second = advanceSymbolState('BTCUSDT', first.state, candles, config)
    const rearms = second.trades.filter((t) => t.reason === 'range-idle-rearm')
    expect(rearms).toHaveLength(1)
    expect(rearms[0].entryPrice).toBe(90)
    expect(rearms[0].exitPrice).toBe(88)
    expect(rearms[0].pnlQuote).toBeLessThan(0) // the bag is cut honestly
    expect(second.state.outsideRangeStreak).toBe(0)
    // Re-armed range recentres onto the recent window (upper pulled down
    // toward the 88-close regime instead of the stale 110).
    expect(second.state.armed).toBe(true)
    expect(second.state.upper).toBeLessThan(110)
  })

  it('is a no-op when rearmOutsideRangeCandles is 0 (default)', () => {
    const config = cfg({
      rangeLookbackCandles: 5,
      gridCount: 3,
      spacing: 'arithmetic',
      efficiencyGate: false,
      upperStopPct: 0.5,
      lowerStopPct: 0.5,
      autoRecenter: true,
    })
    const candles: Array<Candle> = []
    for (let i = 5; i < 15; i++) candles.push(flat(i, 88, 1))
    const result = advanceSymbolState('BTCUSDT', seededHeld(), candles, config)
    expect(result.trades).toHaveLength(0)
    expect(result.state.levels[0].held).toBe(true)
    expect(result.state.lower).toBe(90)
    expect(result.state.upper).toBe(110)
  })
})

describe('runGridPaperCycle — I/O + lock', () => {
  it('does not run when the connectivity breaker is tripped — this engine\'s first-ever global gate', async () => {
    const { recordConnectivityOutcome } = await import('./connectivity-breaker')
    const CRED_FAILURE = 'Binance demo /api/v3/order failed (401): Unauthorized'
    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(CRED_FAILURE)
    const { runGridPaperCycle } = await import('./grid-paper-engine')
    const fetchKlines = vi.fn()
    const result = await runGridPaperCycle({ fetchKlines })
    expect(result.ran).toBe(false)
    expect(result.reason).toBe('connectivity breaker tripped')
    expect(fetchKlines).not.toHaveBeenCalled()
  })

  it('serializes overlapping cycles — the second is rejected as busy', async () => {
    const { runGridPaperCycle } = await import('./grid-paper-engine')
    const candles: Array<Candle> = []
    for (let i = 0; i < 5; i++) candles.push(candle(i, { open: 100, high: 110, low: 90, close: 100 }))
    const fetchKlines = vi.fn().mockResolvedValue(candles)

    const [a, b] = await Promise.all([
      runGridPaperCycle({ fetchKlines }),
      runGridPaperCycle({ fetchKlines }),
    ])
    const busy = [a, b].filter((r) => !r.ran && r.reason === 'busy')
    expect(busy).toHaveLength(1)
  })

  it('persists grid state through the finance store and getGridEngineState reads it back', async () => {
    const { runGridPaperCycle, getGridEngineState } = await import('./grid-paper-engine')
    const candles: Array<Candle> = []
    for (let i = 0; i < 5; i++) candles.push(candle(i, { open: 100, high: 110, low: 90, close: 100 }))
    candles.push(candle(5, { open: 92, high: 95, low: 85, close: 90 }))
    const fetchKlines = vi.fn().mockResolvedValue(candles)

    const result = await runGridPaperCycle({ fetchKlines })
    expect(result.ran).toBe(true)
    expect(result.symbolsProcessed).toBe(DEFAULT_GRID_ENGINE_CONFIG.symbols.length)

    const state = getGridEngineState()
    expect(state.states.length).toBe(DEFAULT_GRID_ENGINE_CONFIG.symbols.length)
    // Only 6 candles were fetched, well under the default 200-candle
    // rangeLookback, so the grid correctly stays unarmed — this test is
    // about the store round-trip (persist → re-read), not arming.
    const btc = state.states.find((s: GridSymbolState) => s.symbol === 'BTCUSDT')
    expect(btc?.symbol).toBe('BTCUSDT')
    expect(btc?.armed).toBe(false)
    expect(btc?.lastProcessedOpenTime).toBe(candles[candles.length - 1].openTime)
  })
})
