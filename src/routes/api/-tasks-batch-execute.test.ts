import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  batchExecuteBackground: vi.fn(() => ({
    started: 2,
    skipped: 1,
    remaining: 3,
  })),
  allowed: true,
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
  batchExecuteBackground: state.batchExecuteBackground,
}))

vi.mock('../../server/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => state.allowed,
  requireJsonContentType: (request: Request) =>
    request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
      ? null
      : new Response(JSON.stringify({ ok: false, error: 'JSON required' }), {
          status: 415,
          headers: { 'content-type': 'application/json' },
        }),
  rateLimitResponse: () =>
    new Response(JSON.stringify({ ok: false, error: 'Too many requests' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { Route } = await import('./tasks-batch-execute')
const post = (
  Route as unknown as {
    server: {
      handlers: {
        POST: (input: { request: Request }) => Promise<Response>
      }
    }
  }
).server.handlers.POST

function request(body?: unknown): Request {
  return new Request('http://localhost/api/tasks-batch-execute', {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/tasks-batch-execute', () => {
  it('requires authentication before starting background work', async () => {
    state.authenticated = false
    const response = await post({ request: request({ limit: 2 }) })

    expect(response.status).toBe(401)
    expect(state.batchExecuteBackground).not.toHaveBeenCalled()
    state.authenticated = true
  })

  it('requires JSON content type before starting background work', async () => {
    const response = await post({
      request: new Request('http://localhost/api/tasks-batch-execute', {
        method: 'POST',
        body: JSON.stringify({ limit: 2 }),
      }),
    })

    expect(response.status).toBe(415)
    expect(state.batchExecuteBackground).not.toHaveBeenCalled()
  })

  it('clamps the requested limit and forwards explicit task IDs', async () => {
    const response = await post({
      request: request({ limit: 99, taskIds: ['task-a', 'task-b'] }),
    })

    expect(response.status).toBe(200)
    expect(state.batchExecuteBackground).toHaveBeenCalledWith(20, [
      'task-a',
      'task-b',
    ])
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      started: 2,
    })
  })

  it('uses the safe default for malformed request bodies', async () => {
    const malformed = new Request('http://localhost/api/tasks-batch-execute', {
      method: 'POST',
      body: '{not-json',
      headers: { 'content-type': 'application/json' },
    })

    const response = await post({ request: malformed })

    expect(response.status).toBe(200)
    expect(state.batchExecuteBackground).toHaveBeenCalledWith(5, undefined)
  })
})
