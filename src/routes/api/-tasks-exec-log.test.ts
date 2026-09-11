import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ authenticated: true }))

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

const { Route } = await import('./tasks-exec-log')
const get = (
  Route as unknown as {
    server: { handlers: { GET: (input: { request: Request }) => Response } }
  }
).server.handlers.GET

describe('GET /api/tasks-exec-log', () => {
  it('requires authentication before reading execution logs', async () => {
    state.authenticated = false
    const response = get({
      request: new Request(
        'http://localhost/api/tasks-exec-log?task_id=task-1',
      ),
    })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({ ok: false })
    state.authenticated = true
  })

  it('validates the required task id', async () => {
    const response = get({
      request: new Request('http://localhost/api/tasks-exec-log'),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'task_id is required',
    })
  })

  it('returns an explicit not-found log response', async () => {
    const response = get({
      request: new Request(
        'http://localhost/api/tasks-exec-log?task_id=missing',
      ),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      log: '',
      found: false,
    })
  })
})
