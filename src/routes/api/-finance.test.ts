import { describe, expect, it, vi } from 'vitest'

type NewsIngestionResult = Awaited<
  ReturnType<
    typeof import('../../server/finance-news.service').fetchAndStoreGoogleNews
  >
>
type PaperDecisionResult = ReturnType<
  typeof import('../../server/paper-decision-journal').appendPaperDecisionSnapshot
>
type CompositeResult = ReturnType<
  typeof import('../../server/finance-intelligence').buildCompositeSentiment
>
type ResearchRiskResult = ReturnType<
  typeof import('../../server/finance-intelligence').assessResearchRisk
>
type IntelligenceStoreResult = ReturnType<
  typeof import('../../server/finance-store').storeIntelligenceRecords
>
type FxQuote = Awaited<
  ReturnType<
    typeof import('../../server/finance-fx-provider').fetchFrankfurterRate
  >
>

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
  scheduledTransactions: [] as Array<Record<string, unknown>>,
  postedIncome: [] as Array<Record<string, unknown>>,
  postedExpense: [] as Array<Record<string, unknown>>,
  assessResearchRisk: vi.fn<() => ResearchRiskResult>(() => ({
    riskLevel: 'low_risk' as const,
    riskScore: 0,
    confidenceScore: 0.5,
    blockers: [],
    inputs: {},
  })),
  buildCompositeSentiment: vi.fn<() => CompositeResult>(() => ({
    symbol: 'BTCUSDT',
    score: 0,
    confidence: 0.5,
    label: 'neutral' as const,
    freshness: 1,
    sourceIds: [],
    disagreement: false,
    blockers: [],
    formulaVersion: 'research-v1',
    observedAt: '2026-08-20T12:00:00.000Z',
    expiresAt: '2026-08-22T12:00:00.000Z',
  })),
  fetchNews: vi.fn<() => Promise<NewsIngestionResult>>(async () => ({
    fetched: 2,
    stored: 1,
    items: [],
  })),
  appendPaperDecisionSnapshot: vi.fn<() => PaperDecisionResult>(() => ({
    appended: true,
    entry: {
      id: 'decision-1',
      kind: 'research_snapshot',
      symbol: 'BTCUSDT',
      compositeIntelligenceId: 'intelligence-1',
      compositeScore: 0,
      provenance: {
        formulaVersion: 'research-v1',
        sourceIds: [],
        observedAt: '',
      },
      recordedAt: '',
      idempotencyKey: 'test',
      side_effects: false,
    },
  })),
  readPaperDecisionJournal: vi.fn<() => Array<unknown>>(() => [
    { id: 'decision-1', symbol: 'BTCUSDT', composite: { score: 0 } },
  ]),
  evaluatePaperDecisionQuality: vi.fn<(input: unknown) => unknown>(() => ({
    sampleCount: 1,
    sideEffects: false,
    validations: { enoughPaperData: false },
  })),
  storeIntelligenceRecords: vi.fn<() => IntelligenceStoreResult>(() => ({
    stored: true,
    sentiment: {} as IntelligenceStoreResult['sentiment'],
    risk: {} as IntelligenceStoreResult['risk'],
    intelligence: {} as IntelligenceStoreResult['intelligence'],
  })),
  fetchFx: vi.fn<() => Promise<FxQuote>>(async () => ({
    base: 'LKR',
    target: 'USD',
    rate: 0.0031,
    date: '2026-09-10',
    source: 'frankfurter:v2',
    observedAt: '2026-09-10T12:00:00.000Z',
  })),
}))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => state.authenticated,
}))
vi.mock('../../server/finance-news.service', () => ({
  fetchAndStoreGoogleNews: state.fetchNews,
}))
vi.mock('../../server/finance-fx-provider', () => ({
  fetchFrankfurterRate: state.fetchFx,
  assessFxProviderHealth: vi.fn(() => ({
    status: 'unknown',
    detail: 'test fixture',
  })),
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
  SUPPORTED_CURRENCIES: ['LKR', 'AUD', 'USD'],
  TRADING_MODES: [],
  addFinanceSplit: vi.fn(),
  addFinanceTransfer: vi.fn(),
  addFinanceRecord: vi.fn((kind: string, payload: Record<string, unknown>) => {
    const record = { id: `posted-${kind}`, ...payload }
    if (kind === 'income') state.postedIncome.push(record)
    else state.postedExpense.push(record)
    return {
      settings: {},
      connectivityBreaker: {},
      historical_candles: [],
      strategy_results: [],
      news_items: [],
      sentiment_scores: [],
      exchange_rates: [],
      scheduled_transactions: state.scheduledTransactions,
      finance_accounts: [],
      income_records: state.postedIncome,
      expense_records: state.postedExpense,
      net_worth_snapshots: [],
    }
  }),
  updateFinanceRecord: vi.fn((kind: string, id: string, payload: Record<string, unknown>) => {
    if (kind === 'scheduled_transaction') {
      const row = state.scheduledTransactions.find((item) => item.id === id)
      if (row) Object.assign(row, payload)
    }
  }),
  appendAuditLog: vi.fn(),
  annualBudgetVsActualSummary: vi.fn(() => []),
  budgetVsActualSummary: vi.fn(() => []),
  buildTransactionsCsv: vi.fn(() => 'id,kind\n'),
  buildTaxRecordsCsv: vi.fn(() => 'id,taxYear\n'),
  cseProviderHealth: vi.fn(() => ({
    status: 'unknown',
    holdingsCount: 0,
    cseQuoteCount: 0,
    manualFallbackCount: 0,
    staleQuoteCount: 0,
    latestQuoteAt: null,
  })),
  ensureFinanceStore: vi.fn(() => ({
    settings: {},
    connectivityBreaker: {},
    historical_candles: [],
    strategy_results: [],
    news_items: [],
    sentiment_scores: [],
    exchange_rates: [],
    scheduled_transactions: [],
  })),
  financeAlerts: vi.fn(() => []),
  financeStorageAlerts: vi.fn(() => []),
  financeStorageStatus: vi.fn(() => ({
    health: {},
    postgres: { database: 'finance' },
  })),
  financeSummary: vi.fn(() => ({})),
  financialHealthSummary: vi.fn(() => ({
    score: 50,
    band: 'needs_attention',
    components: [],
  })),
  getAverageMonthlyExpensesLkr: vi.fn(() => 0),
  getAverageMonthlySavingsRatePct: vi.fn(() => 0),
  getUnifiedTransactions: vi.fn(() => []),
  maskSensitive: vi.fn((obj) => obj),
  readFinanceStore: vi.fn(() => ({
    settings: {},
    connectivityBreaker: {},
    historical_candles: [],
    strategy_results: [],
    news_items: [],
    sentiment_scores: [],
    exchange_rates: [],
    finance_accounts: [],
    income_records: [],
    expense_records: [],
    net_worth_snapshots: [],
    scheduled_transactions: state.scheduledTransactions,
  })),
  readFinanceAuditLog: vi.fn(() => ''),
  readTransactionAudit: vi.fn(() => []),
  safeToSpendSummary: vi.fn(() => ({
    cashLkr: 0,
    reserveLkr: 0,
    amountLkr: 0,
    configured: false,
    basis: 'test',
  })),
  storeIntelligenceRecords: state.storeIntelligenceRecords,
  tradingPerformanceSummary: vi.fn(() => ({})),
  updateExchangeRate: vi.fn(),
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
  const actual =
    await importOriginal<typeof import('../../server/demo-trading-engine')>()
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
  const actual =
    await importOriginal<typeof import('../../server/connectivity-breaker')>()
  return {
    ...actual,
    isConnectivityBreakerTripped: vi.fn(() => false),
    resetConnectivityBreaker: vi.fn(),
  }
})
vi.mock('../../server/rate-limit', () => ({
  getClientIp: () => 'test-client',
  rateLimit: () => true,
  rateLimitResponse: () => new Response('too many requests', { status: 429 }),
  requireJsonContentType: () => null,
  safeErrorMessage: (error: unknown) => String(error),
}))
vi.mock('../../server/validation-run', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../server/validation-run')>()
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
  it('rejects posting a missing scheduled transaction without mutation', async () => {
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'post_scheduled', id: 'missing' }),
      }),
    })

    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ ok: false })
  })

  it('posts a pending scheduled expense into the ledger and marks it posted', async () => {
    state.scheduledTransactions.push({
      id: 'scheduled-1',
      dueDate: '2026-10-01',
      kind: 'expense',
      counterparty: 'Landlord',
      category: 'Rent',
      amount: 100000,
      notes: 'October rent',
      status: 'pending',
    })
    const store = await import('../../server/finance-store')
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'post_scheduled', id: 'scheduled-1' }),
      }),
    })

    expect(response.status).toBe(200)
    expect(vi.mocked(store.addFinanceRecord)).toHaveBeenCalledWith('expense', {
      date: '2026-10-01',
      vendor: 'Landlord',
      category: 'Rent',
      amount: 100000,
      currency: 'LKR',
      accountId: undefined,
      notes: 'October rent',
    })
    expect(vi.mocked(store.updateFinanceRecord)).toHaveBeenCalledWith(
      'scheduled_transaction',
      'scheduled-1',
      { status: 'posted', postedRecordId: 'posted-expense' },
    )
  })

  it('rejects reposting a scheduled transaction already marked posted', async () => {
    state.scheduledTransactions.push({
      id: 'scheduled-posted',
      dueDate: '2026-10-02',
      kind: 'expense',
      counterparty: 'Landlord',
      category: 'Rent',
      amount: 100000,
      status: 'posted',
      postedRecordId: 'expense-existing',
    })
    const store = await import('../../server/finance-store')
    const before = vi.mocked(store.addFinanceRecord).mock.calls.length
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'post_scheduled', id: 'scheduled-posted' }),
      }),
    })

    expect(response.status).toBe(404)
    expect(vi.mocked(store.addFinanceRecord).mock.calls.length).toBe(before)
  })

  it('posts a pending scheduled income into the ledger and marks it posted', async () => {
    state.scheduledTransactions.push({
      id: 'scheduled-income-1',
      dueDate: '2026-10-15',
      kind: 'income',
      counterparty: 'Client',
      category: 'Consulting',
      amount: 250000,
      status: 'pending',
    })
    const store = await import('../../server/finance-store')
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'post_scheduled',
          id: 'scheduled-income-1',
        }),
      }),
    })

    expect(response.status).toBe(200)
    expect(vi.mocked(store.addFinanceRecord)).toHaveBeenCalledWith('income', {
      dateReceived: '2026-10-15',
      sourceName: 'Client',
      incomeType: 'Consulting',
      originalAmount: 250000,
      originalCurrency: 'LKR',
      accountId: undefined,
      notes: undefined,
    })
    expect(vi.mocked(store.updateFinanceRecord)).toHaveBeenCalledWith(
      'scheduled_transaction',
      'scheduled-income-1',
      { status: 'posted', postedRecordId: 'posted-income' },
    )
  })

  it('dispatches an authenticated split-expense action', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'add_split',
          payload: {
            vendor: 'Supermarket',
            splits: [
              { category: 'Food', amount: 10 },
              { category: 'Home', amount: 5 },
            ],
          },
        }),
      }),
    })

    expect(response.status).toBe(200)
    expect(vi.mocked(store.addFinanceSplit)).toHaveBeenCalledWith({
      vendor: 'Supermarket',
      splits: [
        { category: 'Food', amount: 10 },
        { category: 'Home', amount: 5 },
      ],
    })
  })

  it('serves the authenticated unified transaction CSV as a download', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.buildTransactionsCsv).mockReturnValueOnce(
      'id,kind\ntransaction-1,expense\n',
    )
    const response = await (
      await handlers()
    ).GET({
      request: new Request(
        'http://localhost/api/finance?scope=personal_finance&format=csv',
      ),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain(
      'hermes-transactions-',
    )
    expect(await response.text()).toContain('transaction-1')
    expect(vi.mocked(store.buildTransactionsCsv)).toHaveBeenCalled()
  })

  it('persists a bounded budget warning threshold', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set_budget_alert_threshold',
          pct: 125,
        }),
      }),
    })

    expect(response.status).toBe(200)
    expect(vi.mocked(store.writeFinanceStore)).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ budgetAlertThresholdPct: 100 }),
      }),
    )
    expect(vi.mocked(store.appendAuditLog)).toHaveBeenCalledWith(
      'budget_alert_threshold_updated',
      { pct: 100 },
    )
    vi.clearAllMocks()
  })

  it('validates and stores a manual exchange rate', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set_exchange_rate',
          base: 'lkr',
          target: 'usd',
          rate: 0.0032,
          date: '2026-09-10',
        }),
      }),
    })
    expect(response.status).toBe(200)
    expect(vi.mocked(store.updateExchangeRate)).toHaveBeenCalledWith(
      'LKR',
      'USD',
      0.0032,
      '2026-09-10',
    )
    vi.clearAllMocks()
  })

  it('refreshes an exchange rate through the explicit provider action', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'refresh_exchange_rate',
          base: 'lkr',
          target: 'usd',
        }),
      }),
    })
    expect(response.status).toBe(200)
    expect(state.fetchFx).toHaveBeenCalledWith('LKR', 'USD')
    expect(vi.mocked(store.updateExchangeRate)).toHaveBeenCalledWith(
      'LKR',
      'USD',
      0.0031,
      '2026-09-10',
      'frankfurter:v2',
      '2026-09-10T12:00:00.000Z',
    )
    vi.clearAllMocks()
  })

  it('persists a validated reporting currency without rewriting records', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set_base_currency',
          baseCurrency: 'usd',
        }),
      }),
    })
    expect(response.status).toBe(200)
    expect(vi.mocked(store.writeFinanceStore)).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ baseCurrency: 'USD' }),
      }),
    )
    expect(vi.mocked(store.appendAuditLog)).toHaveBeenCalledWith(
      'base_currency_updated',
      { baseCurrency: 'USD' },
    )
    vi.clearAllMocks()
  })

  it('persists the explicit opt-in policy for review-only proactive insights', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'set_proactive_insights',
          enabled: true,
        }),
      }),
    })
    expect(response.status).toBe(200)
    expect(vi.mocked(store.writeFinanceStore)).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ proactiveInsightsEnabled: true }),
      }),
    )
    expect(vi.mocked(store.appendAuditLog)).toHaveBeenCalledWith(
      'proactive_insights_policy_updated',
      { enabled: true, source: 'finance_api' },
    )
    vi.clearAllMocks()
  })

  it('queues an approval-gated proactive review only after opt-in', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.readFinanceStore).mockReturnValueOnce({
      settings: { proactiveInsightsEnabled: true },
      ai_tasks: [],
    } as unknown as ReturnType<typeof store.readFinanceStore>)
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'queue_proactive_finance_review' }),
      }),
    })
    expect(response.status).toBe(200)
    expect(vi.mocked(store.addFinanceRecord)).toHaveBeenCalledWith(
      'ai_task',
      expect.objectContaining({
        taskType: 'proactive_finance_review',
        status: 'awaiting_approval',
        approvalRequired: true,
      }),
    )
    vi.clearAllMocks()
  })

  it('returns only a scheduler acknowledgement when requested', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.readFinanceStore).mockReturnValueOnce({
      settings: { proactiveInsightsEnabled: true },
      ai_tasks: [],
    } as unknown as ReturnType<typeof store.readFinanceStore>)
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'queue_proactive_finance_review',
          responseMode: 'scheduler_ack',
        }),
      }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        queued: true,
        taskType: 'proactive_finance_review',
        status: 'awaiting_approval',
      }),
    )
    expect(vi.mocked(store.addFinanceRecord)).toHaveBeenCalledWith(
      'ai_task',
      expect.objectContaining({ taskType: 'proactive_finance_review' }),
    )
    vi.clearAllMocks()
  })

  it('persists quiet mode as a separate non-critical notification policy', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'set_quiet_mode', enabled: true }),
      }),
    })
    expect(response.status).toBe(200)
    expect(vi.mocked(store.writeFinanceStore)).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({ quietModeEnabled: true }),
      }),
    )
    expect(vi.mocked(store.appendAuditLog)).toHaveBeenCalledWith(
      'quiet_mode_updated',
      { enabled: true, source: 'finance_api' },
    )
    vi.clearAllMocks()
  })

  it('persists an effective-dated salary-rate change separately from income events', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.readFinanceStore).mockReturnValueOnce({
      settings: {},
      salaryHistory: [],
    } as unknown as ReturnType<typeof store.readFinanceStore>)
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'add_salary_history',
          employerName: 'Acme',
          effectiveDate: '2026-09-01',
          amount: 250000,
          currency: 'LKR',
          reason: 'Annual review',
        }),
      }),
    })
    expect(response.status).toBe(200)
    expect(vi.mocked(store.writeFinanceStore)).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          salaryHistory: [
            expect.objectContaining({
              employerName: 'Acme',
              effectiveDate: '2026-09-01',
              amount: 250000,
              currency: 'LKR',
            }),
          ],
        }),
      }),
    )
    expect(vi.mocked(store.appendAuditLog)).toHaveBeenCalledWith(
      'salary_history_added',
      expect.objectContaining({ employerName: 'Acme' }),
    )
    vi.clearAllMocks()
  })

  it('serves an authenticated tax CSV as a download', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    const response = await (
      await handlers()
    ).GET({
      request: new Request(
        'http://localhost/api/finance?scope=personal_finance&format=tax-csv',
      ),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain('tax-records')
    expect(vi.mocked(store.buildTaxRecordsCsv)).toHaveBeenCalled()
  })

  it('serves an authenticated read-only monthly finance report', async () => {
    state.authenticated = true
    const response = await (
      await handlers()
    ).GET({
      request: new Request(
        'http://localhost/api/finance?scope=personal_finance&format=monthly-report&month=2026-09',
      ),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/markdown')
    expect(response.headers.get('content-disposition')).toContain(
      'finance-report-2026-09.md',
    )
    expect(await response.text()).toContain('# Monthly finance report — 2026-09')
  })

  it('serves an authenticated encrypted finance backup without plaintext data', async () => {
    state.authenticated = true
    const response = await (
      await handlers()
    ).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({
          action: 'download_encrypted_backup',
          passphrase: 'correct horse battery staple',
        }),
      }),
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain(
      'hermes-finance-backup-',
    )
    const body = await response.text()
    expect(body).toContain('aes-256-gcm')
    expect(body).not.toContain('battery')
  })

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
    vi.mocked(store.readFinanceStore).mockReturnValue({
      news_items: [{ id: 'news-1' }],
      sentiment_scores: [{ id: 'fg-1' }],
    } as any)
    const composite = {
      symbol: 'BTCUSDT',
      score: 20,
      label: 'positive' as const,
      confidence: 0.6,
      freshness: 0.8,
      sourceIds: ['fg-1', 'news-1'],
      disagreement: false,
      blockers: [],
      formulaVersion: 'research-v1' as const,
      observedAt: '2026-08-20T12:00:00.000Z',
      expiresAt: '2026-08-22T12:00:00.000Z',
    }
    state.buildCompositeSentiment.mockReturnValueOnce(composite)
    state.appendPaperDecisionSnapshot.mockReturnValueOnce({
      appended: true,
      entry: {
        id: 'paper-decision:1',
        kind: 'research_snapshot',
        symbol: 'BTCUSDT',
        compositeIntelligenceId: 'intelligence-1',
        compositeScore: 20,
        provenance: {
          formulaVersion: 'research-v1',
          sourceIds: ['fg-1', 'news-1'],
          observedAt: '2026-08-20T12:00:00.000Z',
        },
        recordedAt: '2026-08-20T12:00:00.000Z',
        idempotencyKey: 'click-1',
        side_effects: false,
      },
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

  it('derives and stores research-only intelligence from existing data', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.readFinanceStore).mockReturnValue({
      news_items: [{ id: 'news-1' }],
      sentiment_scores: [{ id: 'fg-1' }],
    } as any)
    state.buildCompositeSentiment.mockReturnValueOnce({
      symbol: 'BTCUSDT',
      score: 20,
      label: 'positive' as const,
      confidence: 0.6,
      freshness: 0.8,
      sourceIds: ['fg-1', 'news-1'],
      disagreement: false,
      blockers: [],
      formulaVersion: 'research-v1',
      observedAt: '2026-08-20T12:00:00.000Z',
      expiresAt: '2026-08-22T12:00:00.000Z',
    })
    state.assessResearchRisk.mockReturnValueOnce({
      riskLevel: 'low_risk' as const,
      riskScore: 25,
      confidenceScore: 0.6,
      blockers: [],
      inputs: {},
    })
    state.storeIntelligenceRecords.mockReturnValueOnce({
      stored: true,
      sentiment: {} as IntelligenceStoreResult['sentiment'],
      risk: {} as IntelligenceStoreResult['risk'],
      intelligence: {} as IntelligenceStoreResult['intelligence'],
    })

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
