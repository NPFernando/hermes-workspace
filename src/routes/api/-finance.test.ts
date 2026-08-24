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
  assessResearchRisk: vi.fn(),
  buildCompositeSentiment: vi.fn(),
  fetchNews: vi.fn(),
  storeIntelligenceRecords: vi.fn(),
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
  ensureFinanceStore: vi.fn(() => ({ settings: {}, connectivityBreaker: {} })),
  financeAlerts: vi.fn(() => []),
  financeStorageAlerts: vi.fn(() => []),
  financeStorageStatus: vi.fn(() => ({ health: {}, postgres: { database: 'finance' } })),
  financeSummary: vi.fn(() => ({})),
  maskSensitive: vi.fn(() => ({})),
  readFinanceStore: vi.fn(),
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
vi.mock('../../server/demo-trading-engine', () => ({
  applyLearningCandidate: vi.fn(), applyRecommendedSafeguards: vi.fn(),
  applyStrategyOverrideRecommendations: vi.fn(), decisionQualityReport: vi.fn(() => ({})),
  demoTradingPerformance: vi.fn(() => ({})), learningReport: vi.fn(() => ({})),
  marketLearningReport: vi.fn(() => ({})), runLearningCycle: vi.fn(),
  safeguardHistory: vi.fn(() => []), setStrategyOverride: vi.fn(), strategyCatalog: vi.fn(() => []),
  strategyOverrideState: vi.fn(() => ({})),
}))
vi.mock('../../server/connectivity-breaker', () => ({ resetConnectivityBreaker: vi.fn() }))
vi.mock('../../server/rate-limit', () => ({ safeErrorMessage: (error: unknown) => String(error) }))

async function handlers() {
  const module = await import('./finance')
  return (module.Route as any).server.handlers
}

describe('/api/finance fetch_news', () => {
  it('rejects an unauthenticated POST before contacting Google News', async () => {
    state.authenticated = false
    const response = await (await handlers()).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST', body: JSON.stringify({ action: 'fetch_news', symbol: 'BTCUSDT' }),
      }),
    })

    expect(response.status).toBe(401)
    expect(state.fetchNews).not.toHaveBeenCalled()
  })

  it('dispatches the authenticated read-only action and returns its result', async () => {
    state.authenticated = true
    state.fetchNews.mockResolvedValueOnce({ fetched: 2, stored: 1, items: [] })
    const response = await (await handlers()).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST', body: JSON.stringify({ action: 'fetch_news', symbol: 'btcusdt' }),
      }),
    })

    expect(state.fetchNews).toHaveBeenCalledWith('BTCUSDT')
    expect(await response.json()).toMatchObject({
      ok: true, newsIngestion: { fetched: 2, stored: 1 },
    })
  })

  it('derives and stores research-only intelligence from existing data', async () => {
    state.authenticated = true
    const store = await import('../../server/finance-store')
    vi.mocked(store.readFinanceStore).mockReturnValue({
      news_items: [{ id: 'news-1' }],
      sentiment_scores: [{ id: 'fg-1' }],
    } as any)
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
      riskLevel: 'low_risk', riskScore: 25, confidenceScore: 0.6,
      blockers: [], inputs: {},
    })
    state.storeIntelligenceRecords.mockReturnValueOnce({ stored: true })

    const response = await (await handlers()).POST({
      request: new Request('http://localhost/api/finance', {
        method: 'POST',
        body: JSON.stringify({ action: 'refresh_intelligence', symbol: 'btcusdt' }),
      }),
    })

    expect(state.buildCompositeSentiment).toHaveBeenCalledWith(expect.objectContaining({
      symbol: 'BTCUSDT',
      items: [{ id: 'news-1' }],
      sentimentScores: [{ id: 'fg-1' }],
    }))
    expect(state.storeIntelligenceRecords).toHaveBeenCalledWith(expect.objectContaining({
      sentiment: expect.objectContaining({ symbol: 'BTCUSDT', kind: 'news_composite' }),
      risk: expect.objectContaining({ platform: 'research_only', symbol: 'BTCUSDT' }),
    }))
    expect(await response.json()).toMatchObject({
      ok: true,
      intelligence: { researchOnly: true, stored: { stored: true } },
    })
  })
})
