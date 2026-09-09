import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))
vi.mock('@tanstack/react-start', () => ({
  json: (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    }),
}))

const state = vi.hoisted(() => ({
  authenticated: true,
  // Generics kept wide (like readPaperDecisionJournal below) so per-test
  // `.mockReturnValueOnce({...})` overrides with richer shapes don't trip
  // TS2353 excess-property checks.
  assessResearchRisk: vi.fn<(...a: Array<unknown>) => unknown>(() => ({
    ok: true,
    risk: 'low',
  })),
  buildCompositeSentiment: vi.fn<(...a: Array<unknown>) => unknown>(() => ({
    symbol: 'BTCUSDT',
    score: 0,
    confidence: 0.5,
    label: 'neutral',
  })),
  fetchNews: vi.fn<(...a: Array<unknown>) => Promise<unknown>>(async () => ({
    fetched: 2,
    stored: 1,
  })),
  appendPaperDecisionSnapshot: vi.fn<(...a: Array<unknown>) => unknown>(() => ({
    id: 'decision-1',
    symbol: 'BTCUSDT',
    composite: { score: 0, confidence: 0.5 },
    researchOnly: true,
  })),
  readPaperDecisionJournal: vi.fn<() => Array<unknown>>(() => [
    { id: 'decision-1', symbol: 'BTCUSDT', composite: { score: 0 } },
  ]),
  evaluatePaperDecisionQuality: vi.fn<(input: unknown) => unknown>(() => ({
    sampleCount: 1,
    sideEffects: false,
    validations: { enoughPaperData: false },
  })),
  storeIntelligenceRecords: vi.fn(() => ({ stored: true })),
  // A stand-in FinanceDatabase: known keys are real, any other collection the
  // handler reads (financePayload / recoverValidationRunAutomationIfStale touch
  // several) resolves to an empty array instead of `undefined` — so an added
  // `db.<collection>.filter(...)` upstream can't turn into a runtime TypeError
  // in this fully-mocked test.
  mockFinanceDb: (overrides: Record<string, unknown> = {}) =>
    new Proxy(
      { settings: {}, connectivityBreaker: {}, ...overrides },
      {
        get: (t, p) =>
          p in t ? (t as Record<string | symbol, unknown>)[p] : [],
      },
    ),
}))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => state.authenticated,
}))
vi.mock('../../server/finance-news.service', () => ({
  fetchAndStoreGoogleNews: state.fetchNews,
}))
vi.mock('../../server/finance-intelligence', () => ({
  INTELLIGENCE_FORMULA_VERSION: 'research-v1',
  assessResearchRisk: state.assessResearchRisk,
  buildCompositeSentiment: state.buildCompositeSentiment,
}))
vi.mock('../../server/paper-decision-journal', () => ({
  appendPaperDecisionSnapshot: state.appendPaperDecisionSnapshot,
  readPaperDecisionJournal: state.readPaperDecisionJournal,
}))
vi.mock('../../server/paper-decision-quality', () => ({
  evaluatePaperDecisionQuality: state.evaluatePaperDecisionQuality,
}))
vi.mock('../../server/finance-storage-monitor', () => ({
  startFinanceStorageMonitor: vi.fn(),
}))
vi.mock('../../server/finance-store', () => ({
  FINANCE_AUDIT_PATH: '/tmp/audit.jsonl',
  FINANCE_DATA_PATH: '/tmp/finance.json',
  TRADING_MODES: [],
  addFinanceRecord: vi.fn(),
  appendAuditLog: vi.fn(),
  budgetVsActualSummary: vi.fn(() => []),
  ensureFinanceStore: vi.fn(() => state.mockFinanceDb()),
  financeAlerts: vi.fn(() => []),
  financeStorageAlerts: vi.fn(() => []),
  financeStorageStatus: vi.fn(() => ({
    health: {},
    postgres: { database: 'finance' },
  })),
  financeSummary: vi.fn(() => ({})),
  getUnifiedTransactions: vi.fn(() => []),
  maskSensitive: vi.fn((obj) => obj),
  readFinanceStore: vi.fn(() => state.mockFinanceDb()),
  SUPPORTED_CURRENCIES: ['LKR', 'AUD', 'USD'],
  convertCurrency: vi.fn((amount: number) => amount),
  getExchangeRate: vi.fn(() => undefined),
  getAverageMonthlyExpensesLkr: vi.fn(() => 0),
  getAverageMonthlySavingsRatePct: vi.fn(() => ({ actualPct: 0, hasData: false })),
  storeIntelligenceRecords: state.storeIntelligenceRecords,
  tradingPerformanceSummary: vi.fn(() => ({})),
  writeFinanceStore: vi.fn(),
}))
vi.mock('../../server/binance-market.service', () => ({
  addBinanceCandles: vi.fn(),
  addMarketPrice: vi.fn(),
  fetchBinanceKlines: vi.fn(),
  fetchBinanceTickerPrice: vi.fn(),
}))
vi.mock('../../server/trading-strategies', () => ({ STRATEGIES: [] }))
vi.mock('../../server/demo-trading-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/demo-trading-engine')>()
  return {
    ...actual,
    applyLearningCandidate: vi.fn(),
    applyRecommendedSafeguards: vi.fn(),
    applyStrategyOverrideRecommendations: vi.fn(),
    decisionQualityReport: vi.fn(() => ({
      validations: {
        enoughPaperData: false,
        enoughDataForTestnet: false,
      },
    })),
    demoTradingPerformance: vi.fn(() => ({})),
    getFullEngineHistory: vi.fn(() => ({
      trades: [],
      archivedTrades: [],
      positions: [],
      archivedPositions: [],
    })),
    getLastTradingCycleDiagnostics: vi.fn(() => null),
    getLiveMonitor: vi.fn(async () => ({
      monitoring: [],
      prices: {},
      asOfMs: Date.now(),
      cacheAgeSeconds: 0,
    })),
    getStrategyEligibilityAudit: vi.fn(() => ({
      generatedAt: new Date().toISOString(),
      executionMode: 'paper_trade',
      interval: '5m',
      asOfMs: Date.now(),
      councilThreshold: 0.6,
      symbols: [],
    })),
    learningReport: vi.fn(() => ({})),
    marketLearningReport: vi.fn(() => ({})),
    rearmSandboxExperiment: vi.fn(() => ({ ok: true })),
    reviewSandboxExperiments: vi.fn(() => ({ active: [], history: [] })),
    rollbackSandboxExperiment: vi.fn(() => ({ ok: true })),
    runLearningCycle: vi.fn(),
    safeguardHistory: vi.fn(() => []),
    setStrategyOverride: vi.fn(),
    startSandboxExperiment: vi.fn(() => ({ ok: true })),
    stopSandboxExperiment: vi.fn(() => ({ ok: true })),
    strategyCatalog: vi.fn(() => []),
    strategyGuardReview: vi.fn(() => []),
    strategyOverrideState: vi.fn(() => ({})),
  }
})
vi.mock('../../server/connectivity-breaker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/connectivity-breaker')>()
  return {
    ...actual,
    isConnectivityBreakerTripped: vi.fn(() => false),
    resetConnectivityBreaker: vi.fn(),
  }
})
vi.mock('../../server/rate-limit', () => ({
  safeErrorMessage: (error: unknown) => String(error),
}))
vi.mock('../../server/validation-run', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/validation-run')>()
  return {
    ...actual,
    ensureValidationRunAutomation: vi.fn(),
    recoverValidationRunAutomationIfStale: vi.fn(),
    runValidationCycle: vi.fn(),
    startValidationRun: vi.fn(),
    stopValidationRun: vi.fn(),
    finalizeValidationRun: vi.fn(),
    validationRunsPayload: vi.fn(() => ({ runs: [] })),
    validationReconciliationPayload: vi.fn(() => ({ runs: [] })),
  }
})

async function handlers() {
  const module = await import('./finance')
  return (module.Route as any).server.handlers
}

describe('/api/finance fetch_news', () => {
  it('exposes read-only paper-decision quality only through the authenticated finance payload', async () => {
    state.authenticated = true
    state.readPaperDecisionJournal.mockReturnValueOnce([
      { id: 'paper-decision:one' },
    ])
    state.evaluatePaperDecisionQuality.mockReturnValueOnce({
      sampleCount: 1,
      coveredSampleCount: 1,
      sideEffects: false,
    })
    const store = await import('../../server/finance-store')

    const response = await (
      await handlers()
    ).GET({
      request: new Request('http://localhost/api/finance'),
    })

    expect(response.status).toBe(200)
    expect(state.evaluatePaperDecisionQuality).toHaveBeenCalledWith(
      expect.objectContaining({
        decisions: [{ id: 'paper-decision:one' }],
        historicalCandles: [],
      }),
    )
    expect(vi.mocked(store.writeFinanceStore)).not.toHaveBeenCalled()
    expect(vi.mocked(store.addFinanceRecord)).not.toHaveBeenCalled()
    expect(vi.mocked(store.appendAuditLog)).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      ok: true,
      paperDecisionQuality: {
        sampleCount: 1,
        coveredSampleCount: 1,
        sideEffects: false,
      },
    })
  })

  it('rejects an unauthenticated POST before contacting Google News', async () => {
    state.authenticated = false
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'fetch_news', symbol: 'BTCUSDT' }),
      }),
    })

    expect(response.status).toBe(401)
    expect(state.fetchNews).not.toHaveBeenCalled()
  })

  it('dispatches the authenticated read-only action and returns its result', async () => {
    state.authenticated = true
    state.fetchNews.mockResolvedValueOnce({ fetched: 2, stored: 1, items: [] })
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'fetch_news', symbol: 'btcusdt' }),
      }),
    })

    expect(state.fetchNews).toHaveBeenCalledWith('BTCUSDT')
    expect(await response.json()).toMatchObject({
      ok: true,
      newsIngestion: { fetched: 2, stored: 1 },
    })
  })

  it('records an authenticated paper research snapshot without touching intelligence storage or execution state', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.readFinanceStore).mockReturnValue(
      state.mockFinanceDb({
        news_items: [{ id: 'news-1' }],
        sentiment_scores: [{ id: 'fg-1' }],
      }) as any,
    )
    const composite = {
      symbol: 'BTCUSDT',
      score: 20,
      label: 'positive',
      confidence: 0.6,
      freshness: 0.8,
      sourceIds: ['fg-1', 'news-1'],
      disagreement: false,
      blockers: [],
      formulaVersion: 'research-v1',
      observedAt: '2026-08-20T12:00:00.000Z',
      expiresAt: '2026-08-22T12:00:00.000Z',
    }
    state.buildCompositeSentiment.mockReturnValueOnce(composite)
    state.appendPaperDecisionSnapshot.mockReturnValueOnce({
      appended: true,
      entry: { id: 'paper-decision:1', side_effects: false },
    })

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'record_paper_decision',
          symbol: 'btcusdt',
          platform: 'ibkr',
          idempotencyKey: 'click-1',
        }),
      }),
    })

    expect(state.appendPaperDecisionSnapshot).toHaveBeenCalledWith({
      symbol: 'BTCUSDT',
      composite,
      idempotencyKey: 'click-1',
    })
    expect(state.storeIntelligenceRecords).not.toHaveBeenCalled()
    expect(vi.mocked(store.addFinanceRecord)).not.toHaveBeenCalled()
    expect(vi.mocked(store.appendAuditLog)).not.toHaveBeenCalled()
    expect(vi.mocked(store.writeFinanceStore)).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      ok: true,
      paperDecisionJournal: {
        appended: true,
        researchOnly: true,
        entry: { side_effects: false },
      },
    })
  })

  it('rejects an unauthenticated paper journal request before reading research data', async () => {
    state.authenticated = false
    const store = await import('../../server/finance-store')
    vi.mocked(store.readFinanceStore).mockClear()
    state.appendPaperDecisionSnapshot.mockClear()

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'record_paper_decision',
          symbol: 'BTCUSDT',
          idempotencyKey: 'click-2',
        }),
      }),
    })

    expect(response.status).toBe(401)
    expect(vi.mocked(store.readFinanceStore)).not.toHaveBeenCalled()
    expect(state.appendPaperDecisionSnapshot).not.toHaveBeenCalled()
  })

  it('rejects set_base_currency with an invalid currency code (PF-201)', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.writeFinanceStore).mockClear()
    vi.mocked(store.appendAuditLog).mockClear()

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'set_base_currency', currency: 'dollars' }),
      }),
    })

    expect(response.status).toBe(400)
    expect(vi.mocked(store.writeFinanceStore)).not.toHaveBeenCalled()
    expect(vi.mocked(store.appendAuditLog)).not.toHaveBeenCalled()
  })

  it('set_wealth_goal rejects a non-LKR amount with no exchange rate on file (PF-201)', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.writeFinanceStore).mockClear()
    vi.mocked(store.appendAuditLog).mockClear()
    vi.mocked(store.getExchangeRate).mockReturnValue(undefined)

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set_wealth_goal',
          targetLkr: 1000,
          currency: 'USD',
        }),
      }),
    })

    expect(response.status).toBe(400)
    expect(vi.mocked(store.writeFinanceStore)).not.toHaveBeenCalled()
    expect(vi.mocked(store.appendAuditLog)).not.toHaveBeenCalled()
  })

  it('set_wealth_goal converts the entered base-currency amount to LKR for storage (PF-201)', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.writeFinanceStore).mockClear()
    // getExchangeRate('LKR', 'USD') -> LKR->base rate; the handler inverts it.
    vi.mocked(store.getExchangeRate).mockImplementation((from: string, to: string) =>
      from === 'LKR' && to === 'USD' ? 0.0033 : undefined,
    )

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set_wealth_goal',
          targetLkr: 1000,
          currency: 'USD',
        }),
      }),
    })

    expect(response.status).toBe(200)
    const writes = vi.mocked(store.writeFinanceStore).mock.calls
    expect(writes).toHaveLength(1)
    const savedDb = writes[0][0] as { settings: { wealthGoalTargetLkr: number } }
    // 1000 USD / 0.0033 ~= 303030 LKR — stored, not the entered 1000.
    expect(savedDb.settings.wealthGoalTargetLkr).toBe(Math.round(1000 / 0.0033))
  })

  it('derives and stores research-only intelligence from existing data', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.readFinanceStore).mockReturnValue(
      state.mockFinanceDb({
        news_items: [{ id: 'news-1' }],
        sentiment_scores: [{ id: 'fg-1' }],
      }) as any,
    )
    state.buildCompositeSentiment.mockReturnValueOnce({
      score: 20,
      label: 'positive',
      confidence: 0.6,
      freshness: 0.8,
      sourceIds: ['fg-1', 'news-1'],
      formulaVersion: 'research-v1',
      observedAt: '2026-08-20T12:00:00.000Z',
      expiresAt: '2026-08-22T12:00:00.000Z',
    })
    state.assessResearchRisk.mockReturnValueOnce({
      riskLevel: 'low_risk',
      riskScore: 25,
      confidenceScore: 0.6,
      blockers: [],
      inputs: {},
    })
    state.storeIntelligenceRecords.mockReturnValueOnce({ stored: true })

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'refresh_intelligence',
          symbol: 'btcusdt',
        }),
      }),
    })

    expect(state.buildCompositeSentiment).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'BTCUSDT',
        items: [{ id: 'news-1' }],
        sentimentScores: [{ id: 'fg-1' }],
      }),
    )
    expect(state.storeIntelligenceRecords).toHaveBeenCalledWith(
      expect.objectContaining({
        sentiment: expect.objectContaining({
          symbol: 'BTCUSDT',
          kind: 'news_composite',
        }),
        risk: expect.objectContaining({
          platform: 'research_only',
          symbol: 'BTCUSDT',
        }),
      }),
    )
    expect(await response.json()).toMatchObject({
      ok: true,
      intelligence: { researchOnly: true, stored: { stored: true } },
    })
  })
})
