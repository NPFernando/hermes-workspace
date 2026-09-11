import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// fetchTopTraderLongShortRatio makes a real network call — mock just that
// export so tests never hit fapi.binance.com (same as demo-trading-engine.test.ts).
vi.mock('./long-short-sentiment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./long-short-sentiment')>()
  return { ...actual, fetchTopTraderLongShortRatio: vi.fn() }
})

// finance-store.ts resolves its data path from os.homedir() (honours $HOME
// on POSIX) at module load — point HOME at a temp dir and reset modules so
// every module re-evaluates against it, never touching ~/.hermes/finance.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'validation-run-'))
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

function fakeClient(overrides: Partial<any> = {}) {
  return {
    host: 'demo-api.binance.com',
    environment: 'testnet',
    ping: async () => true,
    getPrice: async () => 100,
    getKlines: async () => steadyDowntrend(),
    getAccount: async () => ({
      accountType: 'SPOT',
      canTrade: true,
      balances: [{ asset: 'USDT', free: 5000, locked: 0 }],
    }),
    placeOrder: async (o: any) => ({
      symbol: o.symbol,
      orderId: Math.floor(Math.random() * 1e6),
      status: 'FILLED',
      side: o.side,
      type: o.type,
      executedQty: 0.25,
      cummulativeQuoteQty: o.side === 'BUY' ? (o.quoteOrderQty ?? 25) : 30,
      fills: [],
      transactTime: Date.now(),
      avgPrice: o.side === 'BUY' ? 100 : 120,
    }),
    ...overrides,
  }
}

// Steady decline → RSI oversold → BUY from the RSI strategy (mirrors
// demo-trading-engine.test.ts's fixture of the same name).
function steadyDowntrend() {
  const closes = Array.from({ length: 31 }, (_, i) => 100 - i * 0.35)
  const base = Date.now() - closes.length * 60 * 60_000
  return closes.map((c, i) => ({
    openTime: base + i * 60 * 60_000,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1,
  }))
}

function flatHighCandles(price: number) {
  const base = Date.now() - 31 * 60 * 60_000
  return Array.from({ length: 31 }, (_, i) => ({
    openTime: base + i * 60 * 60_000,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 1,
  }))
}

const VALID_BUDGETS = {
  maxDurationMs: 60 * 60_000,
  maxCycles: 5,
  maxTrades: 5,
  maxExposureQuote: 100,
}

describe('startValidationRun — strict rejection', () => {
  it('rejects live mode outright, regardless of requested stage', async () => {
    await setMode('live_manual_approval')
    const { startValidationRun } = await import('./validation-run')
    await expect(
      startValidationRun({
        stage: 'sandbox',
        strategies: ['rsi_reversion'],
        budgets: VALID_BUDGETS,
      }),
    ).rejects.toThrow(/never live/)
  })

  it('rejects observe_only / no execution mode', async () => {
    await setMode('observe_only')
    const { startValidationRun } = await import('./validation-run')
    await expect(
      startValidationRun({
        stage: 'paper',
        strategies: ['rsi_reversion'],
        budgets: VALID_BUDGETS,
      }),
    ).rejects.toThrow(/no execution mode|never live/)
  })

  it('rejects a stage that does not match the current tradingMode', async () => {
    await setMode('paper_trade')
    const { startValidationRun } = await import('./validation-run')
    await expect(
      startValidationRun({
        stage: 'sandbox',
        strategies: ['rsi_reversion'],
        budgets: VALID_BUDGETS,
      }),
    ).rejects.toThrow(/does not match/)
  })

  it('rejects when the kill switch is engaged', async () => {
    await setMode('testnet_execute')
    const store = await import('./finance-store')
    const db = store.readFinanceStore()
    db.settings.emergencyKillSwitch = true
    store.writeFinanceStore(db)
    const { startValidationRun } = await import('./validation-run')
    await expect(
      startValidationRun({
        stage: 'sandbox',
        strategies: ['rsi_reversion'],
        budgets: VALID_BUDGETS,
      }),
    ).rejects.toThrow(/kill switch/)
  })

  it.each([
    ['missing budgets object', {}],
    ['zeroed budgets', { maxDurationMs: 0, maxCycles: 0, maxTrades: 0, maxExposureQuote: 0 }],
    [
      'negative budgets',
      { maxDurationMs: -1, maxCycles: -1, maxTrades: -1, maxExposureQuote: -1 },
    ],
    [
      'unbounded (Infinity) budgets',
      {
        maxDurationMs: Infinity,
        maxCycles: Infinity,
        maxTrades: Infinity,
        maxExposureQuote: Infinity,
      },
    ],
    [
      'out-of-range (over the hard cap) budgets',
      {
        maxDurationMs: VALID_BUDGETS.maxDurationMs,
        maxCycles: 1_000_000,
        maxTrades: VALID_BUDGETS.maxTrades,
        maxExposureQuote: VALID_BUDGETS.maxExposureQuote,
      },
    ],
  ])('rejects %s — never unbounded', async (_label, budgets) => {
    await setMode('testnet_execute')
    const { startValidationRun } = await import('./validation-run')
    await expect(
      startValidationRun({
        stage: 'sandbox',
        strategies: ['rsi_reversion'],
        budgets,
      }),
    ).rejects.toThrow(/positive, bounded number|must be between/)
  })

  it('rejects an unknown strategyId', async () => {
    await setMode('testnet_execute')
    const { startValidationRun } = await import('./validation-run')
    await expect(
      startValidationRun({
        stage: 'sandbox',
        strategies: ['not_a_real_strategy'],
        budgets: VALID_BUDGETS,
      }),
    ).rejects.toThrow(/At least one known strategyId/)
  })

  it('rejects a strategy that is known but not currently enabled', async () => {
    await setMode('testnet_execute')
    const store = await import('./finance-store')
    const db = store.readFinanceStore()
    ;(db.settings as Record<string, unknown>).demoTrading = {
      enabledStrategies: ['rsi_reversion'],
    }
    store.writeFinanceStore(db)
    const { startValidationRun } = await import('./validation-run')
    await expect(
      startValidationRun({
        stage: 'sandbox',
        strategies: ['sma_crossover'],
        budgets: VALID_BUDGETS,
      }),
    ).rejects.toThrow(/not currently enabled/)
  })

  it('rejects starting a second active run for the same stage (conflict)', async () => {
    await setMode('testnet_execute')
    const { startValidationRun } = await import('./validation-run')
    const first = await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
    })
    expect(first.run?.status).toBe('active')
    await expect(
      startValidationRun({
        stage: 'sandbox',
        strategies: ['rsi_reversion'],
        budgets: VALID_BUDGETS,
      }),
    ).rejects.toThrow(/already active/)
  })

  it('allows one active run per stage simultaneously (paper + sandbox)', async () => {
    await setMode('testnet_execute')
    const { startValidationRun } = await import('./validation-run')
    const sandboxRun = await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
    })
    expect(sandboxRun.run?.stage).toBe('sandbox')

    await setMode('paper_trade')
    const paperRun = await startValidationRun({
      stage: 'paper',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
    })
    expect(paperRun.run?.stage).toBe('paper')
    expect(paperRun.state.active).toHaveLength(2)
  })

  it('starts successfully with valid, bounded input and records a baseline', async () => {
    await setMode('testnet_execute')
    const { startValidationRun } = await import('./validation-run')
    const result = await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
      notes: 'initial evidence pass',
    })
    expect(result.changed).toBe(true)
    expect(result.run).toMatchObject({
      stage: 'sandbox',
      executionMode: 'testnet',
      strategies: ['rsi_reversion'],
      status: 'active',
      budgets: VALID_BUDGETS,
      notes: 'initial evidence pass',
    })
    expect(result.run?.baseline.recordedAt).toBeTruthy()
    expect(result.run?.progress.cyclesRun).toBe(0)
    expect(result.run?.evidence.ledgerRecordIds).toEqual([])
  })

  it('persists the explicit automatic-cycle setting', async () => {
    await setMode('testnet_execute')
    const { startValidationRun } = await import('./validation-run')
    const result = await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
      autoRun: true,
    })
    expect(result.run?.autoRun).toBe(true)
    expect(result.state.active[0]?.autoRun).toBe(true)
  })
})

describe('runValidationCycle', () => {
  it('returns an error when there is no active run for the stage', async () => {
    await setMode('testnet_execute')
    const { runValidationCycle } = await import('./validation-run')
    const result = await runValidationCycle('sandbox')
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/No active sandbox validation run/)
  })

  it('attributes an OPEN action from runTradingCycle to the run and increments cyclesRun', async () => {
    await setMode('testnet_execute')
    const { startValidationRun, runValidationCycle } =
      await import('./validation-run')
    await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
    })
    const result = await runValidationCycle('sandbox', {
      client: fakeClient() as never,
    })
    expect(result.ok).toBe(true)
    expect(result.cycle?.actions.some((a) => a.action === 'OPEN')).toBe(true)
    expect(result.run?.progress.cyclesRun).toBe(1)
    expect(result.run?.progress.tradesOpened).toBeGreaterThanOrEqual(1)
  })

  it('attributes realized P&L, fees, and a ledger record id once a trade closes', async () => {
    await setMode('testnet_execute')
    const { startValidationRun, runValidationCycle } =
      await import('./validation-run')
    await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
    })
    const opened = await runValidationCycle('sandbox', {
      client: fakeClient() as never,
    })
    expect(opened.cycle?.actions.some((a) => a.action === 'OPEN')).toBe(true)

    const closed = await runValidationCycle('sandbox', {
      client: fakeClient({ getKlines: async () => flatHighCandles(130) }) as never,
    })
    expect(closed.cycle?.actions.some((a) => a.action === 'CLOSE')).toBe(true)
    expect(closed.run?.progress.tradesClosed).toBeGreaterThanOrEqual(1)
    expect(closed.run?.evidence.realizedPnlQuote).toBeGreaterThan(0)
    expect(closed.run?.evidence.ledgerRecordIds.length).toBeGreaterThanOrEqual(1)
  })

  it('rejects further cycles once tradingMode no longer matches the run', async () => {
    await setMode('testnet_execute')
    const { startValidationRun, runValidationCycle } =
      await import('./validation-run')
    await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
    })
    await setMode('paper_trade')
    const result = await runValidationCycle('sandbox', {
      client: fakeClient() as never,
    })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/tradingMode changed/)
  })

  it('auto-completes the run once the cycle budget is reached', async () => {
    await setMode('testnet_execute')
    const { startValidationRun, runValidationCycle, reviewValidationRuns } =
      await import('./validation-run')
    await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: { ...VALID_BUDGETS, maxCycles: 1 },
    })
    await runValidationCycle('sandbox', { client: fakeClient() as never })
    const state = reviewValidationRuns()
    expect(state.active).toHaveLength(0)
    expect(state.history[0]?.status).toBe('completed')
    expect(state.history[0]?.endReason).toMatch(/cycle budget reached/)
  })
})

describe('restart recovery (time-budget reconciliation)', () => {
  it('moves an overdue active run to history purely from wall-clock age, with no in-memory timer', async () => {
    await setMode('testnet_execute')
    const { startValidationRun, reviewValidationRuns } =
      await import('./validation-run')
    const started = await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: { ...VALID_BUDGETS, maxDurationMs: 60_000 },
    })
    expect(started.run).toBeTruthy()

    // Simulate the process having restarted long after the time budget
    // elapsed: back-date createdAt directly in the persisted store (no
    // timer is ever created by this module — see reconcileExpiry()).
    const store = await import('./finance-store')
    const db = store.readFinanceStore()
    const state = (db.settings as Record<string, unknown>)
      .validationRuns as { active: Array<{ createdAt: string }> }
    state.active[0]!.createdAt = new Date(Date.now() - 3_600_000).toISOString()
    store.writeFinanceStore(db)

    const reconciled = reviewValidationRuns()
    expect(reconciled.active).toHaveLength(0)
    expect(reconciled.history[0]?.status).toBe('expired')
    expect(reconciled.history[0]?.endReason).toMatch(/time budget exceeded/)
  })
})

describe('stopValidationRun / finalizeValidationRun', () => {
  it('stops an active run with a recorded reason', async () => {
    await setMode('testnet_execute')
    const { startValidationRun, stopValidationRun } =
      await import('./validation-run')
    await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
    })
    const result = stopValidationRun('sandbox', 'operator abort')
    expect(result.ok).toBe(true)
    expect(result.run?.status).toBe('stopped')
    expect(result.run?.endReason).toBe('operator abort')
    expect(result.state.active).toHaveLength(0)
  })

  it('throws when stopping a stage with no active run', async () => {
    await setMode('testnet_execute')
    const { stopValidationRun } = await import('./validation-run')
    expect(() => stopValidationRun('sandbox', 'n/a')).toThrow(
      /No active sandbox validation run/,
    )
  })

  it('finalizes an active run as completed and captures a readiness-impact snapshot', async () => {
    await setMode('testnet_execute')
    const { startValidationRun, finalizeValidationRun } =
      await import('./validation-run')
    await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
      notes: 'first pass',
    })
    const result = finalizeValidationRun('sandbox', 'enough evidence collected')
    expect(result.ok).toBe(true)
    expect(result.run?.status).toBe('completed')
    expect(result.run?.notes).toBe('enough evidence collected')
    expect(result.run?.readinessImpact).toBeTruthy()
  })
})

describe('validationRunsPayload', () => {
  it('attaches a live readiness-impact snapshot to every active run', async () => {
    await setMode('testnet_execute')
    const { startValidationRun, validationRunsPayload } =
      await import('./validation-run')
    await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
    })
    const payload = validationRunsPayload()
    expect(payload.active).toHaveLength(1)
    expect(payload.active[0]?.liveReadinessImpact?.id).toBe('sandbox_evidence')
  })
})

describe('validationReconciliationPayload', () => {
  it('marks a fresh zero-trade run as incomplete evidence', async () => {
    await setMode('testnet_execute')
    const {
      startValidationRun,
      validationReconciliationPayload,
    } = await import('./validation-run')
    await startValidationRun({
      stage: 'sandbox',
      strategies: ['rsi_reversion'],
      budgets: VALID_BUDGETS,
    })
    const payload = validationReconciliationPayload()
    expect(payload.active).toHaveLength(1)
    expect(payload.active[0]).toMatchObject({
      stage: 'sandbox',
      attributedTradeCount: 0,
      attributedLedgerCount: 0,
      recommendation: 'continue_collecting',
    })
    expect(payload.active[0]?.warnings).toEqual(
      expect.arrayContaining(['no closed trades collected', 'no cycles completed']),
    )
  })
})
