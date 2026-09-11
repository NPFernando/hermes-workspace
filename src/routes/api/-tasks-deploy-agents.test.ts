import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  allowed: true,
  clearStuckTasks: vi.fn(() => 2),
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
  clearStuckTasks: state.clearStuckTasks,
  runAgentDeployBackground: vi.fn(() => ({ taskCount: 0 })),
}))
vi.mock('../../server/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => state.allowed,
  rateLimitResponse: () =>
    new Response(JSON.stringify({ ok: false, error: 'Too many requests' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
}))

const { Route } = await import('./tasks-deploy-agents')
const handlers = (
  Route as unknown as {
    server: {
      handlers: {
        DELETE: (input: { request: Request }) => Response
      }
    }
  }
).server.handlers

describe('DELETE /api/tasks-deploy-agents', () => {
  it('rate-limits manual stuck-task sweeps', async () => {
    state.allowed = false
    const response = handlers.DELETE({
      request: new Request('http://localhost/api/tasks-deploy-agents', {
        method: 'DELETE',
      }),
    })

    expect(response.status).toBe(429)
    expect(state.clearStuckTasks).not.toHaveBeenCalled()
    state.allowed = true
  })

  it('returns the cleared count when the sweep is allowed', async () => {
    const response = handlers.DELETE({
      request: new Request('http://localhost/api/tasks-deploy-agents', {
        method: 'DELETE',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      cleared: 2,
    })
  })
})
