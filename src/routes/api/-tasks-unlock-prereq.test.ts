import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  tasks: [],
  updateTask: vi.fn(),
  runAgentDeployBackground: vi.fn(),
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
vi.mock('../../server/tasks-store', () => ({
  listTasks: () => state.tasks,
  updateTask: state.updateTask,
}))
vi.mock('../../server/astra-tasks', () => ({
  runAgentDeployBackground: state.runAgentDeployBackground,
}))
vi.mock('../../server/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => true,
  rateLimitResponse: () => new Response('limited', { status: 429 }),
  requireJsonContentType: (request: Request) =>
    request.headers.get('content-type')?.includes('application/json')
      ? null
      : new Response(JSON.stringify({ ok: false, error: 'JSON required' }), {
          status: 415,
          headers: { 'content-type': 'application/json' },
        }),
}))

const { Route } = await import('./tasks-unlock-prereq')
const post = (
  Route as unknown as {
    server: {
      handlers: { POST: (input: { request: Request }) => Promise<Response> }
    }
  }
).server.handlers.POST

describe('POST /api/tasks-unlock-prereq', () => {
  it('requires authentication before changing prerequisite state', async () => {
    state.authenticated = false
    const response = await post({
      request: new Request('http://localhost/api/tasks-unlock-prereq', {
        method: 'POST',
        body: JSON.stringify({ prereq_id: 'p1' }),
        headers: { 'content-type': 'application/json' },
      }),
    })

    expect(response.status).toBe(401)
    expect(state.updateTask).not.toHaveBeenCalled()
    state.authenticated = true
  })

  it('requires JSON content type before parsing the mutation body', async () => {
    const response = await post({
      request: new Request('http://localhost/api/tasks-unlock-prereq', {
        method: 'POST',
        body: JSON.stringify({ prereq_id: 'p1' }),
      }),
    })

    expect(response.status).toBe(415)
    expect(state.updateTask).not.toHaveBeenCalled()
  })

  it('returns not found for an unknown prerequisite', async () => {
    const response = await post({
      request: new Request('http://localhost/api/tasks-unlock-prereq', {
        method: 'POST',
        body: JSON.stringify({ prereq_id: 'missing' }),
        headers: { 'content-type': 'application/json' },
      }),
    })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Prerequisite task not found',
    })
    expect(state.updateTask).not.toHaveBeenCalled()
  })
})
