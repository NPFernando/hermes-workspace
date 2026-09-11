import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  allowed: true,
  runTradingCycle: vi.fn(async () => ({ ran: true, actions: [] })),
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
  requireJsonContentType: () => null,
  safeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error',
}))
vi.mock('../../server/demo-trading-engine', () => ({
  runTradingCycle: state.runTradingCycle,
  getEngineState: vi.fn(),
  getLastTradingCycleDiagnostics: vi.fn(),
  getLiveMonitor: vi.fn(),
  getStrategyEligibilityAudit: vi.fn(),
  decisionQualityReport: vi.fn(),
  marketLearningReport: vi.fn(),
}))

const { Route } = await import('./demo-trading')
const post = (
  Route as unknown as {
    server: {
      handlers: { POST: (input: { request: Request }) => Promise<Response> }
    }
  }
).server.handlers.POST

function request(body: unknown): Request {
  return new Request('http://localhost/api/demo-trading', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/demo-trading', () => {
  it('requires authentication', async () => {
    state.authenticated = false

    const response = await post({ request: request({ action: 'run_cycle' }) })

    expect(response.status).toBe(401)
    expect(state.runTradingCycle).not.toHaveBeenCalled()
    state.authenticated = true
  })

  it('rejects unknown actions', async () => {
    const response = await post({ request: request({ action: 'unknown' }) })

    expect(response.status).toBe(400)
    expect(state.runTradingCycle).not.toHaveBeenCalled()
  })

  it('passes force but never forwards caller-supplied engine configuration', async () => {
    state.runTradingCycle.mockClear()

    const response = await post({
      request: request({
        action: 'run_cycle',
        force: true,
        config: {
          guardian: { minQuoteBalance: 0, perTradeQuoteCap: 1_000 },
        },
      }),
    })

    expect(response.status).toBe(200)
    expect(state.runTradingCycle).toHaveBeenCalledWith({ force: true })
  })
})
