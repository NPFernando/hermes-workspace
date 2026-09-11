import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  contentTypeError: null as Response | null,
  allowed: true,
  upsert: vi.fn(() => ({ workerId: 'ada' })),
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
vi.mock('../../server/swarm-roster', () => ({
  SWARM_ROSTER_PATH: '/tmp/swarm-roster.json',
  readSwarmRoster: vi.fn(() => []),
  upsertSwarmRosterWorker: state.upsert,
}))
vi.mock('../../server/swarm-foundation', () => ({
  listSwarmWorkerIds: vi.fn(() => ['ada']),
}))

const { Route } = await import('./swarm-roster')
const post = (
  Route as unknown as {
    server: {
      handlers: { POST: (input: { request: Request }) => Promise<Response> }
    }
  }
).server.handlers.POST

function request(body?: unknown): Request {
  return new Request('http://localhost/api/swarm-roster', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

describe('POST /api/swarm-roster', () => {
  it('requires authentication', async () => {
    state.authenticated = false

    const response = await post({ request: request({ workerId: 'ada' }) })

    expect(response.status).toBe(401)
    expect(state.upsert).not.toHaveBeenCalled()
    state.authenticated = true
  })

  it('requires a JSON content type before parsing', async () => {
    state.contentTypeError = new Response(
      JSON.stringify({ ok: false, error: 'JSON content type required' }),
      { status: 415, headers: { 'content-type': 'application/json' } },
    )

    const response = await post({ request: request({ workerId: 'ada' }) })

    expect(response.status).toBe(415)
    expect(state.upsert).not.toHaveBeenCalled()
    state.contentTypeError = null
  })

  it('rate-limits and persists an authenticated JSON request', async () => {
    state.allowed = false
    const limited = await post({ request: request({ workerId: 'ada' }) })
    expect(limited.status).toBe(429)

    state.allowed = true
    const response = await post({ request: request({ workerId: 'ada' }) })

    expect(response.status).toBe(200)
    expect(state.upsert).toHaveBeenCalledWith({ workerId: 'ada' }, ['ada'])
  })
})
