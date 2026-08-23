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
  fetchNews: vi.fn(),
}))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => state.authenticated,
}))
vi.mock('../../server/finance-news.service', () => ({
  fetchAndStoreGoogleNews: state.fetchNews,
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
})
