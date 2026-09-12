import { describe, expect, it, vi } from 'vitest'
import type * as DemoTradingEngineModule from '../../server/demo-trading-engine'
import type * as ConnectivityBreakerModule from '../../server/connectivity-breaker'
import type * as ValidationRunModule from '../../server/validation-run'

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
  computeAccountLedgerBalance: vi.fn(() => null),
  ledgerTransactionsForDb: vi.fn(() => []),
  recordNetWorthSnapshot: vi.fn((db) => ({
    db,
    snapshot: { date: '2026-09-10', netWorthLkr: 0 },
  })),
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
  getFinanceTrends: vi.fn(() => ({ series: [], categoriesThisMonth: [] })),
  getRecurringBills: vi.fn(() => []),
  getUpcomingMoney: vi.fn(() => ({
    paydays: [],
    contracts: [],
    fdMaturities: [],
    scheduled: [],
  })),
  getCurrencyExposure: vi.fn(() => []),
  getFxGainLoss: vi.fn(() => ({
    entries: [],
    totalAssetGainLkr: 0,
    totalFxGainLkr: 0,
    totalReturnLkr: 0,
    excludedCount: 0,
  })),
  getAverageMonthlyExpensesLkr: vi.fn(() => 0),
  getAverageMonthlySavingsRatePct: vi.fn(() => ({ actualPct: 0, hasData: false })),
  storeIntelligenceRecords: state.storeIntelligenceRecords,
  tradingPerformanceSummary: vi.fn(() => ({})),
  updateExchangeRate: vi.fn(),
  writeFinanceStore: vi.fn(),
  listPendingIngestions: vi.fn(() => []),
  updatePendingIngestion: vi.fn(),
  getCategoryCorrections: vi.fn(() => ({})),
  findPossibleDuplicate: vi.fn(() => null),
  copyBudgetsToMonth: vi.fn(() => ({ copied: 0, skippedExisting: 0 })),
  getNetWorthForecast: vi.fn(() => ({
    hasData: false,
    currentNetWorthBase: 0,
    monthlyDeltaBase: 0,
    monthsOfHistoryUsed: 0,
    points: [],
  })),
}))
// Neither of these was mocked before (the pending_ingestions actions —
// submit_ingestion_password, confirm_pending_ingestion, and now
// retry_pending_extraction — had zero test coverage in this file), which
// meant the *real* network-calling functions would run if any test ever
// exercised those actions. Mock them explicitly rather than leaving that trap.
vi.mock('../../server/finance-extraction', () => ({
  answerFinanceQuestion: vi.fn(),
  extractEmploymentContract: vi.fn(),
  extractTransactionFromImage: vi.fn(),
}))
vi.mock('../../server/document-normalizer', () => ({
  isPdfEncrypted: vi.fn(() => false),
  pdfToImages: vi.fn(),
}))
vi.mock('../../server/exchange-rate.service', () => ({
  fetchLkrExchangeRates: vi.fn(),
}))
vi.mock('../../server/binance-market.service', () => ({
  addBinanceCandles: vi.fn(),
  addMarketPrice: vi.fn(),
  fetchBinanceKlines: vi.fn(),
  fetchBinanceTickerPrice: vi.fn(),
}))
vi.mock('../../server/trading-strategies', () => ({ STRATEGIES: [] }))
vi.mock('../../server/demo-trading-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof DemoTradingEngineModule>()
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
  const actual = await importOriginal<typeof ConnectivityBreakerModule>()
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
  const actual = await importOriginal<typeof ValidationRunModule>()
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

describe('/api/finance?scope=personal_finance windowing (PF review item 1)', () => {
  it('drops income/expense rows older than the window and stamps transactionsWindowMonths', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const old = new Date()
    old.setFullYear(old.getFullYear() - 5)
    const recent = new Date().toISOString().slice(0, 10)
    vi.mocked(store.financeSummary).mockReturnValue({
      baseCurrency: 'LKR',
    } as never)
    vi.mocked(store.readFinanceStore).mockReturnValue(
      state.mockFinanceDb({
        income_records: [
          { id: 'i-old', dateReceived: old.toISOString().slice(0, 10) },
          { id: 'i-new', dateReceived: recent },
        ],
        expense_records: [
          { id: 'e-old', date: old.toISOString().slice(0, 10) },
          { id: 'e-new', date: recent },
        ],
      }) as never,
    )
    vi.mocked(store.ensureFinanceStore).mockReturnValue(
      state.mockFinanceDb({
        income_records: [
          { id: 'i-old', dateReceived: old.toISOString().slice(0, 10) },
          { id: 'i-new', dateReceived: recent },
        ],
        expense_records: [
          { id: 'e-old', date: old.toISOString().slice(0, 10) },
          { id: 'e-new', date: recent },
        ],
      }) as never,
    )

    const response = await (
      await handlers()
    ).GET({
      request: new Request(
        'http://localhost/api/finance?scope=personal_finance',
      ),
    })
    const body = (await response.json()) as {
      transactionsWindowMonths: number
      data: {
        income_records: Array<{ id: string }>
        expense_records: Array<{ id: string }>
      }
    }
    expect(body.transactionsWindowMonths).toBe(36)
    expect(body.data.income_records.map((r) => r.id)).toEqual(['i-new'])
    expect(body.data.expense_records.map((r) => r.id)).toEqual(['e-new'])
  })

  it('data.exchange_rates collapses history to the latest row per base->target pair', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.financeSummary).mockReturnValue({
      baseCurrency: 'LKR',
    } as never)
    const rows = [
      { base: 'USD', target: 'LKR', rate: 300, date: '2026-09-08' },
      { base: 'USD', target: 'LKR', rate: 328.4, date: '2026-09-10' },
      { base: 'USD', target: 'LKR', rate: 320, date: '2026-09-09' },
      { base: 'LKR', target: 'USD', rate: 1 / 328.4, date: '2026-09-10' },
      { base: 'AUD', target: 'LKR', rate: 236.8, date: '2026-09-10' },
    ]
    vi.mocked(store.readFinanceStore).mockReturnValue(
      state.mockFinanceDb({ exchange_rates: rows }) as never,
    )
    vi.mocked(store.ensureFinanceStore).mockReturnValue(
      state.mockFinanceDb({ exchange_rates: rows }) as never,
    )

    const response = await (
      await handlers()
    ).GET({
      request: new Request(
        'http://localhost/api/finance?scope=personal_finance',
      ),
    })
    const body = (await response.json()) as {
      data: { exchange_rates: Array<{ base: string; target: string; rate: number; date: string }> }
    }
    const er = body.data.exchange_rates
    expect(er).toHaveLength(3) // USD->LKR, LKR->USD, AUD->LKR — one each
    const usdLkr = er.find((r) => r.base === 'USD' && r.target === 'LKR')
    expect(usdLkr).toMatchObject({ rate: 328.4, date: '2026-09-10' })
  })
})

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
    // Once — the handler makes exactly one getExchangeRate('LKR', ...) call
    // before it resolves, and this must not leak into later tests in the file.
    vi.mocked(store.getExchangeRate).mockImplementationOnce(
      (from: string, to: string) =>
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

  it('refresh_exchange_rates writes both legs per currency, reverse = reciprocal (PF-201)', async () => {
    // The handler derives its stored date from the real clock
    // (`new Date().toISOString().slice(0, 10)` in finance.ts), not from the
    // fetched `asOf` — a hardcoded expected date here broke every day after
    // it was written (confirmed: failed once the wall clock rolled past
    // 2026-09-10). Pin the clock instead of hardcoding "today".
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T12:00:00.000Z'))
    try {
      state.authenticated = true
      const store = await import('../../server/finance-store')
      const svc = await import('../../server/exchange-rate.service')
      vi.mocked(store.updateExchangeRate).mockClear()
      vi.mocked(svc.fetchLkrExchangeRates).mockResolvedValue({
        lkrPer: { USD: 300, AUD: 200 },
        asOf: '2026-09-10T00:02:31.000Z',
        source: 'open.er-api.com',
      })

      const response = await (
        await handlers()
      ).POST({
        request: new Request('http://localhost/api/finance', {
          method: 'POST',
          body: JSON.stringify({ action: 'refresh_exchange_rates' }),
        }),
      })

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        ok: boolean
        source: string
        updated: Array<{ pair: string }>
      }
      expect(body.ok).toBe(true)
      expect(body.source).toBe('open.er-api.com')
      expect(body.updated.map((u) => u.pair).sort()).toEqual(['AUD/LKR', 'USD/LKR'])

      const calls = vi.mocked(store.updateExchangeRate).mock.calls
      // USD: <cur>->LKR at 300, LKR-><cur> at 1/300
      expect(calls).toContainEqual(['USD', 'LKR', 300, '2026-09-10'])
      const usdBack = calls.find((c) => c[0] === 'LKR' && c[1] === 'USD')
      expect(usdBack?.[2]).toBeCloseTo(1 / 300)
      expect(calls).toContainEqual(['AUD', 'LKR', 200, '2026-09-10'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('refresh_exchange_rates returns 502 and writes nothing when the source is down', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const svc = await import('../../server/exchange-rate.service')
    vi.mocked(store.updateExchangeRate).mockClear()
    vi.mocked(svc.fetchLkrExchangeRates).mockResolvedValue(null)

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'refresh_exchange_rates' }),
      }),
    })

    expect(response.status).toBe(502)
    expect(vi.mocked(store.updateExchangeRate)).not.toHaveBeenCalled()
  })

  it('retry_pending_extraction re-runs extraction from the saved preview image and clears the prior error on success', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const extraction = await import('../../server/finance-extraction')
    vi.mocked(store.listPendingIngestions).mockReturnValue([
      {
        id: 'p1',
        status: 'awaiting_review',
        source: 'gmail',
        documentType: 'transaction',
        sourceRef: '/tmp/original.pdf',
        rawPreviewImagePath: '/tmp/preview.png',
        error: 'all_routes_failed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    vi.mocked(extraction.extractTransactionFromImage).mockResolvedValue({
      ok: true,
      data: {
        kind: 'expense',
        amount: 500,
        currency: 'LKR',
        vendorOrSource: 'Starlink',
        date: '2026-01-01',
        confidence: 'high',
      },
    })
    vi.mocked(store.updatePendingIngestion).mockImplementation((id, patch) => ({
      id,
      status: 'awaiting_review',
      source: 'gmail',
      documentType: 'transaction',
      sourceRef: '/tmp/original.pdf',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      ...patch,
    }))

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'retry_pending_extraction', id: 'p1' }),
      }),
    })

    expect(response.status).toBe(200)
    expect(vi.mocked(extraction.extractTransactionFromImage)).toHaveBeenCalledWith(
      '/tmp/preview.png',
      {},
    )
    expect(vi.mocked(store.updatePendingIngestion)).toHaveBeenCalledWith('p1', {
      extracted: expect.objectContaining({ vendorOrSource: 'Starlink' }),
      error: undefined,
    })
    const body = (await response.json()) as {
      ok: boolean
      pendingIngestion: { extracted?: { vendorOrSource: string } }
    }
    expect(body.ok).toBe(true)
    expect(body.pendingIngestion.extracted?.vendorOrSource).toBe('Starlink')
  })

  it('retry_pending_extraction records the new failure reason when it fails again', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const extraction = await import('../../server/finance-extraction')
    vi.mocked(store.listPendingIngestions).mockReturnValue([
      {
        id: 'p2',
        status: 'awaiting_review',
        source: 'gmail',
        documentType: 'transaction',
        sourceRef: '/tmp/original.pdf',
        rawPreviewImagePath: '/tmp/preview.png',
        error: 'all_routes_failed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    vi.mocked(extraction.extractTransactionFromImage).mockResolvedValue({
      ok: false,
      reason: 'all_routes_failed',
    })
    vi.mocked(store.updatePendingIngestion).mockImplementation((id, patch) => ({
      id,
      status: 'awaiting_review',
      source: 'gmail',
      documentType: 'transaction',
      sourceRef: '/tmp/original.pdf',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      ...patch,
    }))

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'retry_pending_extraction', id: 'p2' }),
      }),
    })

    expect(response.status).toBe(200)
    expect(vi.mocked(store.updatePendingIngestion)).toHaveBeenCalledWith('p2', {
      extracted: undefined,
      error: 'all_routes_failed',
    })
  })

  it('retry_pending_extraction returns 400 when there is no saved preview image to retry from', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.listPendingIngestions).mockReturnValue([
      {
        id: 'p3',
        status: 'awaiting_review',
        source: 'upload',
        documentType: 'transaction',
        sourceRef: '/tmp/original.pdf',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ])

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'retry_pending_extraction', id: 'p3' }),
      }),
    })

    expect(response.status).toBe(400)
  })

  it('retry_pending_extraction returns 404 for an unknown id', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.listPendingIngestions).mockReturnValue([])

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'retry_pending_extraction', id: 'missing' }),
      }),
    })

    expect(response.status).toBe(404)
  })

  it('list_transactions pages the unified history by id cursor (PF review item 9)', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const rows = Array.from({ length: 5 }, (_, i) => ({
      id: `t-${i}`,
      kind: i % 2 ? 'income' : 'expense',
      date: `2026-06-${10 - i}`,
      amount: 100 + i,
    }))
    vi.mocked(store.getUnifiedTransactions).mockReturnValue(rows as never)

    const call = (bodyObj: Record<string, unknown>) =>
      handlers().then((h) =>
        h.POST({
          request: new Request('http://localhost/api/finance', {
            method: 'POST',
            body: JSON.stringify({ action: 'list_transactions', ...bodyObj }),
          }),
        }),
      )

    const first = (await (await call({ limit: 2 })).json()) as {
      ok: boolean
      transactions: Array<{ id: string }>
      nextCursor: string | null
      total: number
    }
    expect(first.ok).toBe(true)
    expect(first.transactions.map((t) => t.id)).toEqual(['t-0', 't-1'])
    expect(first.nextCursor).toBe('t-1')
    expect(first.total).toBe(5)

    const second = (await (
      await call({ limit: 2, cursor: first.nextCursor })
    ).json()) as { transactions: Array<{ id: string }>; nextCursor: string | null }
    expect(second.transactions.map((t) => t.id)).toEqual(['t-2', 't-3'])
    expect(second.nextCursor).toBe('t-3')

    const third = (await (
      await call({ limit: 2, cursor: second.nextCursor })
    ).json()) as { transactions: Array<{ id: string }>; nextCursor: string | null }
    expect(third.transactions.map((t) => t.id)).toEqual(['t-4'])
    expect(third.nextCursor).toBeNull()
  })

  it('list_transactions clamps limit and restarts on an unknown cursor', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const rows = Array.from({ length: 3 }, (_, i) => ({ id: `x-${i}`, date: '2026-06-01' }))
    vi.mocked(store.getUnifiedTransactions).mockReturnValue(rows as never)

    const res = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'list_transactions',
          limit: 9999,
          cursor: 'nope',
        }),
      }),
    })
    const data = (await res.json()) as { transactions: Array<{ id: string }> }
    // limit clamped to 500 (> 3 rows) and unknown cursor -> from the top
    expect(data.transactions.map((t) => t.id)).toEqual(['x-0', 'x-1', 'x-2'])
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

describe('import_transactions_csv', () => {
  it('creates a record per valid row and reports the count', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.addFinanceRecord).mockClear()
    vi.mocked(store.findPossibleDuplicate).mockReturnValue(null)

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'import_transactions_csv',
          rows: [
            {
              kind: 'expense',
              date: '2026-01-01',
              amount: 1500,
              currency: 'LKR',
              vendorOrSource: 'Cargills',
              category: 'Groceries',
            },
            {
              kind: 'income',
              date: '2026-01-02',
              amount: 5000,
              currency: 'LKR',
              vendorOrSource: 'Employer',
            },
          ],
        }),
      }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      ok: boolean
      created: number
      skippedDuplicates: number
      errors: Array<unknown>
    }
    expect(body.ok).toBe(true)
    expect(body.created).toBe(2)
    expect(body.skippedDuplicates).toBe(0)
    expect(body.errors).toEqual([])
    expect(vi.mocked(store.addFinanceRecord)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(store.addFinanceRecord)).toHaveBeenCalledWith(
      'expense',
      expect.objectContaining({ vendor: 'Cargills', date: '2026-01-01', amount: 1500 }),
    )
    expect(vi.mocked(store.addFinanceRecord)).toHaveBeenCalledWith(
      'income',
      expect.objectContaining({ sourceName: 'Employer', dateReceived: '2026-01-02' }),
    )
  })

  it('skips a row findPossibleDuplicate flags, without creating a record', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.addFinanceRecord).mockClear()
    vi.mocked(store.findPossibleDuplicate).mockReturnValueOnce({
      id: 'existing-1',
      vendorOrSource: 'Cargills',
      date: '2026-01-01',
      amount: 1500,
    })

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'import_transactions_csv',
          rows: [
            {
              kind: 'expense',
              date: '2026-01-01',
              amount: 1500,
              vendorOrSource: 'Cargills',
            },
          ],
        }),
      }),
    })

    const body = (await response.json()) as {
      created: number
      skippedDuplicates: number
    }
    expect(body.created).toBe(0)
    expect(body.skippedDuplicates).toBe(1)
    expect(vi.mocked(store.addFinanceRecord)).not.toHaveBeenCalled()
  })

  it('force:true bypasses the duplicate check', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.addFinanceRecord).mockClear()
    vi.mocked(store.findPossibleDuplicate).mockReturnValue({
      id: 'existing-1',
      vendorOrSource: 'Cargills',
      date: '2026-01-01',
      amount: 1500,
    })

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'import_transactions_csv',
          force: true,
          rows: [
            { kind: 'expense', date: '2026-01-01', amount: 1500, vendorOrSource: 'Cargills' },
          ],
        }),
      }),
    })

    const body = (await response.json()) as { created: number }
    expect(body.created).toBe(1)
    expect(vi.mocked(store.addFinanceRecord)).toHaveBeenCalledTimes(1)
  })

  it('collects a per-row error for an invalid row without failing the whole batch', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.addFinanceRecord).mockClear()
    vi.mocked(store.findPossibleDuplicate).mockReturnValue(null)

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'import_transactions_csv',
          rows: [
            { kind: 'expense', date: '2026-01-01', amount: 1500, vendorOrSource: 'Cargills' },
            { kind: 'transfer', date: '2026-01-01', amount: 100, vendorOrSource: 'X' },
            { kind: 'expense', date: '2026-01-01', amount: -5, vendorOrSource: 'Y' },
          ],
        }),
      }),
    })

    const body = (await response.json()) as {
      created: number
      errors: Array<{ index: number; reason: string }>
    }
    expect(body.created).toBe(1)
    expect(body.errors).toEqual([
      { index: 1, reason: 'kind must be income or expense' },
      { index: 2, reason: 'amount must be a positive number' },
    ])
  })

  it('returns 400 for an empty rows array', async () => {
    state.authenticated = true
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'import_transactions_csv', rows: [] }),
      }),
    })
    expect(response.status).toBe(400)
  })

  it('returns 400 when rows exceeds the 1000-row cap', async () => {
    state.authenticated = true
    const rows = Array.from({ length: 1001 }, (_, i) => ({
      kind: 'expense',
      date: '2026-01-01',
      amount: 1,
      vendorOrSource: `V${i}`,
    }))
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'import_transactions_csv', rows }),
      }),
    })
    expect(response.status).toBe(400)
  })
})

describe('copy_budgets_to_month', () => {
  it('calls copyBudgetsToMonth with the target month and writes the store', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.copyBudgetsToMonth).mockReturnValue({
      copied: 2,
      skippedExisting: 1,
    })
    vi.mocked(store.writeFinanceStore).mockClear()

    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'copy_budgets_to_month', targetMonth: '2026-08' }),
      }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as { copied: number; skippedExisting: number }
    expect(body.copied).toBe(2)
    expect(body.skippedExisting).toBe(1)
    expect(vi.mocked(store.copyBudgetsToMonth)).toHaveBeenCalledWith(
      expect.anything(),
      '2026-08',
    )
    expect(vi.mocked(store.writeFinanceStore)).toHaveBeenCalled()
  })

  it('returns 400 for a missing or malformed targetMonth', async () => {
    state.authenticated = true

    const missing = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'copy_budgets_to_month' }),
      }),
    })
    expect(missing.status).toBe(400)

    const malformed = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'copy_budgets_to_month', targetMonth: 'August 2026' }),
      }),
    })
    expect(malformed.status).toBe(400)
  })
})
