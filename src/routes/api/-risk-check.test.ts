import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  contentTypeError: null as Response | null,
  allowed: true,
  financeAccounts: [{ currency: 'USDT', balance: 1_000 }],
  positions: [] as Array<unknown>,
  dailyPnlQuote: 0,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => state.authenticated,
}))
vi.mock('../../server/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => state.allowed,
  rateLimitResponse: () =>
    new Response(JSON.stringify({ ok: false, error: 'Too many requests' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
  requireJsonContentType: () => state.contentTypeError,
  safeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error',
}))
vi.mock('../../server/finance-store', () => ({
  readFinanceStore: () => ({ finance_accounts: state.financeAccounts }),
}))
vi.mock('../../server/demo-trading-engine', () => ({
  getEngineState: () => ({
    positions: state.positions,
    dailyPnlQuote: state.dailyPnlQuote,
  }),
}))

const { Route } = await import('./risk-check')
const post = (
  Route as unknown as {
    server: {
      handlers: { POST: (input: { request: Request }) => Promise<Response> }
    }
  }
).server.handlers.POST

function request(body?: unknown): Request {
  return new Request('http://localhost/api/risk-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('POST /api/risk-check', () => {
  it('requires authentication before inspecting the request', async () => {
    state.authenticated = false

    const response = await post({ request: request() })

    expect(response.status).toBe(401)
    state.authenticated = true
  })

  it('rejects non-JSON requests before parsing', async () => {
    state.contentTypeError = new Response(
      JSON.stringify({ ok: false, error: 'JSON content type required' }),
      { status: 415, headers: { 'content-type': 'application/json' } },
    )

    const response = await post({ request: request() })

    expect(response.status).toBe(415)
    state.contentTypeError = null
  })

  it('validates the required proposal fields', async () => {
    const response = await post({ request: request({ symbol: 'BTCUSDT' }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'strategyId is required',
    })
  })

  it('returns an allowed verdict for a proposal within the configured limits', async () => {
    state.financeAccounts = [{ currency: 'USDT', balance: 1_000 }]
    state.positions = []
    state.dailyPnlQuote = 0

    const response = await post({
      request: request({
        symbol: 'BTCUSDT',
        strategyId: 'ema_cross',
        quoteAmount: 25,
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      riskCheck: { allowed: true, approvedQuote: 25, blocks: [] },
      proposal: { symbol: 'BTCUSDT', strategyId: 'ema_cross', quoteAmount: 25 },
      context: { quoteBalance: 1_000, openPositions: 0 },
    })
  })

  it('surfaces a balance-floor block instead of approving an unsafe proposal', async () => {
    state.financeAccounts = [{ currency: 'USDT', balance: 510 }]

    const response = await post({
      request: request({
        symbol: 'BTCUSDT',
        strategyId: 'ema_cross',
        quoteAmount: 25,
        config: { minQuoteBalance: 0, perTradeQuoteCap: 1_000 },
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      riskCheck: {
        allowed: false,
        approvedQuote: 25,
        blocks: [{ rule: 'balance_floor' }],
      },
    })

    state.financeAccounts = [{ currency: 'USDT', balance: 1_000 }]
  })
})
