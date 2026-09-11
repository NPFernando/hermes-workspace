import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  drainReadyReview: vi.fn(() => ({ queued: 1, titles: ['Task'] })),
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
vi.mock('../../server/astra-tasks', () => ({
  drainReadyReview: state.drainReadyReview,
}))
vi.mock('../../server/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => true,
  rateLimitResponse: () =>
    new Response(JSON.stringify({ ok: false, error: 'Too many requests' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
  requireJsonContentType: (request: Request) =>
    request.headers.get('content-type')?.includes('application/json')
      ? null
      : new Response(JSON.stringify({ ok: false, error: 'JSON required' }), {
          status: 415,
          headers: { 'content-type': 'application/json' },
        }),
}))

const { Route } = await import('./tasks-drain-now')
const get = (
  Route as unknown as {
    server: { handlers: { GET: (input: { request: Request }) => Response } }
  }
).server.handlers.GET

describe('GET /api/tasks-drain-now', () => {
  it('rejects GET without triggering task execution', async () => {
    const response = get({
      request: new Request('http://localhost/api/tasks-drain-now'),
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(state.drainReadyReview).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ ok: false })
  })
})
