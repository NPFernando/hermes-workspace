import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

// Same isolation pattern as trading-execution-gate.test.ts / rebalance-engine.test.ts:
// point HOME at a temp dir so readFinanceStore/writeFinanceStore never touch the
// real ~/.hermes/finance store, then vi.resetModules() so every dynamic import
// below re-reads that HOME.
let tmp: string
let realHome: string | undefined
let realEnv: NodeJS.ProcessEnv

const state = vi.hoisted(() => ({
  decisionQuality: {
    validations: {
      enoughPaperData: false,
      enoughShadowData: false,
      enoughDataForTestnet: false,
      enoughDataForLiveManual: false,
      canIncreaseRisk: false,
    },
  } as unknown as Record<string, unknown>,
  engineHistory: {
    positions: [] as Array<Record<string, unknown>>,
    trades: [] as Array<Record<string, unknown>>,
    archivedPositions: [] as Array<Record<string, unknown>>,
    archivedTrades: [] as Array<Record<string, unknown>>,
  },
  guardReviews: [] as Array<Record<string, unknown>>,
  ledgerRecords: [] as Array<Record<string, unknown>>,
  breakerTripped: false,
}))

vi.mock('./demo-trading-engine', async () => {
  const actual =
    await vi.importActual<typeof import('./demo-trading-engine')>(
      './demo-trading-engine',
    )
  return {
    ...actual,
    decisionQualityReport: () => state.decisionQuality,
    getFullEngineHistory: () => state.engineHistory,
    strategyGuardReview: () => state.guardReviews,
  }
})
vi.mock('./trading-ledger', async () => {
  const actual =
    await vi.importActual<typeof import('./trading-ledger')>('./trading-ledger')
  return { ...actual, buildLedgerRecords: () => state.ledgerRecords }
})
vi.mock('./connectivity-breaker', async () => {
  const actual =
    await vi.importActual<typeof import('./connectivity-breaker')>(
      './connectivity-breaker',
    )
  return { ...actual, isConnectivityBreakerTripped: () => state.breakerTripped }
})

/** Resets the shared mock state back to a fully-failing baseline before each test. */
function resetMockState() {
  state.decisionQuality = {
    validations: {
      enoughPaperData: false,
      enoughShadowData: false,
      enoughDataForTestnet: false,
      enoughDataForLiveManual: false,
      canIncreaseRisk: false,
    },
  }
  state.engineHistory = {
    positions: [],
    trades: [],
    archivedPositions: [],
    archivedTrades: [],
  }
  state.guardReviews = []
  state.ledgerRecords = []
  state.breakerTripped = false
}

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trading-readiness-'))
  realHome = process.env.HOME
  realEnv = { ...process.env }
  process.env.HOME = tmp
  resetMockState()
  vi.resetModules()
  // Belt-and-suspenders reset: vi.importActual (used by the mocks above to
  // pass through resolveEngineConfig/etc.) caches transitively-imported
  // modules like finance-store.ts *across* vi.resetModules() calls within
  // one test file, so relying on "a fresh HOME means a fresh store" alone
  // isn't safe once any test has created live-readiness approval state.
  // Explicitly wipe that state (and restore safe defaults) at the start of
  // every test instead of trusting module isolation for it.
  const financeStore = await import('./finance-store')
  const db = financeStore.readFinanceStore()
  delete (db.settings as Record<string, unknown>).liveReadiness
  db.settings.emergencyKillSwitch = true
  db.settings.executionAccount = 'paper'
  db.settings.tradingMode = 'observe_only'
  db.settings.liveTradingEnabled = false
  db.settings.liveBinanceApprovedAt = null
  db.settings.liveBinanceApprovalId = null
  financeStore.writeFinanceStore(db)
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  process.env = realEnv
  fs.rmSync(tmp, { recursive: true, force: true })
})

/** Seeds enough closed trades / config to make every gate pass, and sets the
 * env credentials the account_connectivity gate checks the presence of
 * (never used to make a real network call anywhere in trading-readiness.ts). */
async function makeEverythingReady(now: Date) {
  const financeStore = await import('./finance-store')
  const db = financeStore.readFinanceStore()
  db.settings.emergencyKillSwitch = false
  db.settings.executionAccount = 'binance_testnet'
  db.settings.tradingMode = 'testnet_execute'
  db.settings.livePerOrderCapUsdt = 10
  db.settings.demoTrading = {
    noLossExitMode: true,
    enabledStrategies: ['sma_crossover'],
    guardian: {
      maxOpenPositions: 4,
      perTradeQuoteCap: 50,
      maxDailyLossQuote: 100,
      maxWeeklyLossQuote: 500,
      maxOpenDrawdownQuote: 150,
      lossStreakLimit: 3,
      cooldownMinutes: 240,
      minQuoteBalance: 500,
      correlationBucketsEnabled: false,
      correlationBuckets: {},
      maxBucketExposureQuote: 100,
    },
  }
  financeStore.writeFinanceStore(db)

  state.decisionQuality = {
    validations: {
      enoughPaperData: true,
      enoughShadowData: true,
      enoughDataForTestnet: true,
      enoughDataForLiveManual: true,
      canIncreaseRisk: true,
    },
  }
  const recentClosedAt = new Date(now.getTime() - 60_000).toISOString()
  state.engineHistory = {
    positions: [],
    trades: Array.from({ length: 25 }, (_, i) => ({
      closedAt: recentClosedAt,
      executionMode: 'paper',
      id: `paper-${i}`,
    })),
    archivedPositions: [],
    archivedTrades: Array.from({ length: 12 }, (_, i) => ({
      closedAt: recentClosedAt,
      executionMode: 'testnet',
      id: `testnet-${i}`,
    })),
  }
  state.guardReviews = [
    {
      strategyId: 'sma_crossover',
      window: { sufficientSample: true },
    },
  ]
  state.ledgerRecords = []
  state.breakerTripped = false

  process.env.BINANCE_TESTNET_API_KEY = 'testnet-key'
  process.env.BINANCE_TESTNET_API_SECRET = 'testnet-secret'
  process.env.BINANCE_API_KEY = 'live-key'
  process.env.BINANCE_API_SECRET = 'live-secret'
  process.env.BINANCE_ALLOW_LIVE_TRADING = 'I_APPROVE_BINANCE_LIVE_TRADING'
}

describe('assessReadiness — fail-closed on missing/stale evidence', () => {
  it('fails every evidence-dependent gate on a completely fresh store', async () => {
    const readiness = await import('./trading-readiness')
    const snapshot = readiness.assessReadiness(new Date())
    expect(snapshot.allPassed).toBe(false)
    const byId = new Map(snapshot.gates.map((g) => [g.id, g]))
    expect(byId.get('paper_evidence')?.pass).toBe(false)
    expect(byId.get('sandbox_evidence')?.pass).toBe(false)
    expect(byId.get('strategy_sample_size')?.pass).toBe(false)
    expect(byId.get('account_connectivity')?.pass).toBe(false)
    // Fails closed by default: emergencyKillSwitch defaults to true.
    expect(byId.get('kill_switch')?.pass).toBe(false)
    expect(snapshot.blockers.length).toBeGreaterThan(0)
  })

  it('flags paper evidence as stale when the most recent closed trade is older than 30 days', async () => {
    await makeEverythingReady(new Date())
    state.engineHistory.trades = Array.from({ length: 25 }, (_, i) => ({
      closedAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      executionMode: 'paper',
      id: `stale-${i}`,
    }))
    const readiness = await import('./trading-readiness')
    const snapshot = readiness.assessReadiness(new Date())
    const gate = snapshot.gates.find((g) => g.id === 'paper_evidence')
    expect(gate?.pass).toBe(false)
    expect(gate?.detail).toMatch(/stale/)
    expect(gate?.evidenceAgeMs).toBeGreaterThan(30 * 24 * 60 * 60 * 1000)
  })

  it('fails strategy_sample_size when an enabled strategy has insufficient window sample', async () => {
    await makeEverythingReady(new Date())
    state.guardReviews = [
      { strategyId: 'sma_crossover', window: { sufficientSample: false } },
    ]
    const readiness = await import('./trading-readiness')
    const snapshot = readiness.assessReadiness(new Date())
    const gate = snapshot.gates.find((g) => g.id === 'strategy_sample_size')
    expect(gate?.pass).toBe(false)
    expect(gate?.detail).toMatch(/sma_crossover/)
  })

  it('fails ledger_integrity on malformed ledger records (missing/invalid price or quantity)', async () => {
    await makeEverythingReady(new Date())
    state.ledgerRecords = [{ status: 'open', quantity: -1, entryPrice: 100 }]
    const readiness = await import('./trading-readiness')
    const snapshot = readiness.assessReadiness(new Date())
    expect(snapshot.gates.find((g) => g.id === 'ledger_integrity')?.pass).toBe(
      false,
    )
  })

  it('fails account_connectivity when credentials are missing or the breaker is tripped', async () => {
    const readiness = await import('./trading-readiness')
    let snapshot = readiness.assessReadiness(new Date())
    expect(
      snapshot.gates.find((g) => g.id === 'account_connectivity')?.pass,
    ).toBe(false)

    await makeEverythingReady(new Date())
    state.breakerTripped = true
    snapshot = readiness.assessReadiness(new Date())
    const gate = snapshot.gates.find((g) => g.id === 'account_connectivity')
    expect(gate?.pass).toBe(false)
    expect(gate?.detail).toMatch(/breaker/)
  })

  it('fails exposure_caps when livePerOrderCapUsdt is unset or unbounded', async () => {
    await makeEverythingReady(new Date())
    const financeStore = await import('./finance-store')
    const db = financeStore.readFinanceStore()
    db.settings.livePerOrderCapUsdt = 999
    financeStore.writeFinanceStore(db)
    const readiness = await import('./trading-readiness')
    const snapshot = readiness.assessReadiness(new Date())
    expect(snapshot.gates.find((g) => g.id === 'exposure_caps')?.pass).toBe(
      false,
    )
  })

  it('passes every gate once evidence, config, and credentials are all in place', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    const snapshot = readiness.assessReadiness(now)
    expect(snapshot.blockers).toEqual([])
    expect(snapshot.allPassed).toBe(true)
  })
})

describe('requestLiveApproval / approveLiveApproval / activateLiveReadiness', () => {
  it('refuses to request an approval while any gate is failing', async () => {
    const readiness = await import('./trading-readiness')
    const result = readiness.requestLiveApproval(new Date())
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/readiness gates failing/)

    const financeStore = await import('./finance-store')
    const db = financeStore.readFinanceStore()
    expect(db.settings.liveTradingEnabled).not.toBe(true)
    expect(db.settings.liveBinanceApprovedAt ?? null).toBeNull()
  })

  it('creates a pending approval once all gates pass, and repeated requests reuse it', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    const first = readiness.requestLiveApproval(now)
    expect(first.ok).toBe(true)
    expect(first.reused).toBe(false)
    expect(first.approval?.status).toBe('pending')

    const second = readiness.requestLiveApproval(new Date(now.getTime() + 1_000))
    expect(second.ok).toBe(true)
    expect(second.reused).toBe(true)
    expect(second.approval?.id).toBe(first.approval?.id)
  })

  it('rejects approval without the exact phrase', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    readiness.requestLiveApproval(now)
    const result = readiness.approveLiveApproval('not the phrase', now)
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/phrase/)
  })

  it('approves with the exact phrase and sets a future expiry', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    readiness.requestLiveApproval(now)
    const result = readiness.approveLiveApproval(
      readiness.LIVE_READINESS_APPROVAL_PHRASE,
      now,
    )
    expect(result.ok).toBe(true)
    expect(result.approval?.status).toBe('approved')
    expect(Date.parse(result.approval!.expiresAt!)).toBeGreaterThan(
      now.getTime(),
    )
  })

  it('refuses to activate without any approval on record, and never flips live settings', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    const result = readiness.activateLiveReadiness(
      readiness.LIVE_READINESS_APPROVAL_PHRASE,
      now,
    )
    expect(result.ok).toBe(false)
    const financeStore = await import('./finance-store')
    const db = financeStore.readFinanceStore()
    expect(db.settings.liveTradingEnabled).not.toBe(true)
    expect(db.settings.liveBinanceApprovedAt ?? null).toBeNull()
  })

  it('refuses to activate with an approval on record but the wrong phrase', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    readiness.requestLiveApproval(now)
    readiness.approveLiveApproval(readiness.LIVE_READINESS_APPROVAL_PHRASE, now)
    const result = readiness.activateLiveReadiness('nope', now)
    expect(result.ok).toBe(false)
    const financeStore = await import('./finance-store')
    const db = financeStore.readFinanceStore()
    expect(db.settings.liveTradingEnabled).not.toBe(true)
    expect(db.settings.liveBinanceApprovedAt ?? null).toBeNull()
  })

  it('activates only after request + approve + the exact phrase, flipping the same fields the engine order-gate checks', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    readiness.requestLiveApproval(now)
    readiness.approveLiveApproval(readiness.LIVE_READINESS_APPROVAL_PHRASE, now)
    const result = readiness.activateLiveReadiness(
      readiness.LIVE_READINESS_APPROVAL_PHRASE,
      now,
    )
    expect(result.ok).toBe(true)
    expect(result.approval?.status).toBe('activated')

    const financeStore = await import('./finance-store')
    const db = financeStore.readFinanceStore()
    expect(db.settings.liveTradingEnabled).toBe(true)
    expect(db.settings.executionAccount).toBe('binance_live')
    expect(db.settings.tradingMode).toBe('live_manual_approval')
    expect(db.settings.liveBinanceApprovedAt).toBeTruthy()
  })

  it('expires an approved-but-not-yet-activated approval after the TTL', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    readiness.requestLiveApproval(now)
    readiness.approveLiveApproval(readiness.LIVE_READINESS_APPROVAL_PHRASE, now)
    const later = new Date(now.getTime() + readiness.LIVE_APPROVAL_TTL_MS + 1)
    const result = readiness.activateLiveReadiness(
      readiness.LIVE_READINESS_APPROVAL_PHRASE,
      later,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/expired/)

    const financeStore = await import('./finance-store')
    const db = financeStore.readFinanceStore()
    expect(db.settings.liveTradingEnabled).not.toBe(true)
  })

  it('invalidates an approval when risk-relevant settings change before activation (e.g. execution account mismatch)', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    readiness.requestLiveApproval(now)
    readiness.approveLiveApproval(readiness.LIVE_READINESS_APPROVAL_PHRASE, now)

    const financeStore = await import('./finance-store')
    const db = financeStore.readFinanceStore()
    db.settings.executionAccount = 'paper'
    financeStore.writeFinanceStore(db)

    const result = readiness.activateLiveReadiness(
      readiness.LIVE_READINESS_APPROVAL_PHRASE,
      now,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/settings changed|expired/)
    expect(financeStore.readFinanceStore().settings.liveTradingEnabled).not.toBe(
      true,
    )
  })

  it('invalidates an approval when the guardian/per-order caps change before activation', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    readiness.requestLiveApproval(now)
    readiness.approveLiveApproval(readiness.LIVE_READINESS_APPROVAL_PHRASE, now)

    const financeStore = await import('./finance-store')
    const db = financeStore.readFinanceStore()
    db.settings.livePerOrderCapUsdt = 25
    financeStore.writeFinanceStore(db)

    const result = readiness.activateLiveReadiness(
      readiness.LIVE_READINESS_APPROVAL_PHRASE,
      now,
    )
    expect(result.ok).toBe(false)
  })

  it('blocks activation if the kill switch is re-engaged after approval, even with a valid approval record', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    readiness.requestLiveApproval(now)
    readiness.approveLiveApproval(readiness.LIVE_READINESS_APPROVAL_PHRASE, now)

    const financeStore = await import('./finance-store')
    const db = financeStore.readFinanceStore()
    db.settings.emergencyKillSwitch = true
    financeStore.writeFinanceStore(db)

    const result = readiness.activateLiveReadiness(
      readiness.LIVE_READINESS_APPROVAL_PHRASE,
      now,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/kill switch/)
    expect(financeStore.readFinanceStore().settings.liveTradingEnabled).not.toBe(
      true,
    )
  })

  it('re-runs every readiness gate at activation time instead of trusting the approval snapshot', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    readiness.requestLiveApproval(now)
    readiness.approveLiveApproval(readiness.LIVE_READINESS_APPROVAL_PHRASE, now)

    state.decisionQuality = {
      validations: {
        enoughPaperData: false,
        enoughShadowData: false,
        enoughDataForTestnet: false,
        enoughDataForLiveManual: false,
        canIncreaseRisk: false,
      },
    }
    const result = readiness.activateLiveReadiness(
      readiness.LIVE_READINESS_APPROVAL_PHRASE,
      now,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/readiness gates failing/)
  })

  it('deactivateLiveReadiness needs no phrase and always retreats to a safe testnet state', async () => {
    const now = new Date()
    await makeEverythingReady(now)
    const readiness = await import('./trading-readiness')
    readiness.requestLiveApproval(now)
    readiness.approveLiveApproval(readiness.LIVE_READINESS_APPROVAL_PHRASE, now)
    readiness.activateLiveReadiness(readiness.LIVE_READINESS_APPROVAL_PHRASE, now)

    const result = readiness.deactivateLiveReadiness('manual rollback', now)
    expect(result.ok).toBe(true)
    expect(result.approval?.status).toBe('deactivated')

    const financeStore = await import('./finance-store')
    const db = financeStore.readFinanceStore()
    expect(db.settings.liveTradingEnabled).toBe(false)
    expect(db.settings.executionAccount).toBe('binance_testnet')
    expect(db.settings.liveBinanceApprovedAt ?? null).toBeNull()
  })
})
