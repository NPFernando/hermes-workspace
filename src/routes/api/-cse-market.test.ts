import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  contentTypeError: null as Response | null,
  allowed: true,
  snapshot: null as Record<string, unknown> | null,
  history: [] as Array<Record<string, unknown>>,
}))

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
vi.mock('../../server/cse-market-index.service', () => ({
  appendCseMarketSnapshot: vi.fn((snapshot: Record<string, unknown>) => {
    state.snapshot = snapshot
    state.history = [snapshot]
    return state.history
  }),
  fetchCseMarketSnapshot: vi.fn(async () => state.snapshot),
  readCseMarketSnapshots: vi.fn(() => state.history),
}))

const { Route } = await import('./cse-market')
const handlers = (
  Route as unknown as {
    server: {
      handlers: {
        GET: (input: { request: Request }) => Response
        POST: (input: { request: Request }) => Promise<Response>
      }
    }
  }
).server.handlers

function request(method: 'GET' | 'POST', contentType = 'application/json') {
  return new Request('http://localhost/api/cse-market', {
    method,
    headers: { 'content-type': contentType },
    ...(method === 'POST' ? { body: '{}' } : {}),
  })
}

describe('/api/cse-market', () => {
  it('requires authentication for reads', async () => {
    state.authenticated = false
    const response = handlers.GET({ request: request('GET') })
    expect(response.status).toBe(401)
    state.authenticated = true
  })

  it('returns stored history without fetching upstream data', async () => {
    state.history = [{ capturedAt: '2026-09-11T00:00:00.000Z' }]
    const response = handlers.GET({ request: request('GET') })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      latest: state.history[0],
    })
  })

  it('rejects non-JSON refresh requests before upstream access', async () => {
    state.contentTypeError = new Response('JSON required', { status: 415 })
    const response = await handlers.POST({ request: request('POST', 'text/plain') })
    expect(response.status).toBe(415)
    state.contentTypeError = null
  })

  it('rate-limits refresh requests', async () => {
    state.allowed = false
    const response = await handlers.POST({ request: request('POST') })
    expect(response.status).toBe(429)
    state.allowed = true
  })
})
