import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  allowed: true,
  tasks: [] as Array<{
    id: string
    title: string
    description: string
    tags: Array<string>
    column: string
  }>,
  spawnSync: vi.fn(() => ({ status: 0, stderr: '' })),
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
vi.mock('node:child_process', () => ({ spawnSync: state.spawnSync }))
vi.mock('../../server/auth-middleware', () => ({
  requireLocalOrAuth: () => state.authenticated,
}))
vi.mock('../../server/tasks-store', () => ({
  listTasks: () => state.tasks,
}))
vi.mock('../../server/hermes-bin', () => ({ resolveHermesBin: () => 'hermes' }))
vi.mock('../../server/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => state.allowed,
  rateLimitResponse: () => new Response('limited', { status: 429 }),
  requireJsonContentType: (request: Request) =>
    request.headers.get('content-type')?.includes('application/json')
      ? null
      : new Response(JSON.stringify({ ok: false, error: 'JSON required' }), {
          status: 415,
          headers: { 'content-type': 'application/json' },
        }),
}))

const { Route } = await import('./telegram-find')
const post = (
  Route as unknown as {
    server: {
      handlers: { POST: (input: { request: Request }) => Promise<Response> }
    }
  }
).server.handlers.POST

function request(body: unknown): Request {
  return new Request('http://localhost/api/telegram-find', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/telegram-find', () => {
  it('requires local access or authentication', async () => {
    state.authenticated = false
    const response = await post({ request: request({ keyword: 'budget' }) })

    expect(response.status).toBe(401)
    expect(state.spawnSync).not.toHaveBeenCalled()
    state.authenticated = true
  })

  it('validates the keyword before searching or sending', async () => {
    const response = await post({ request: request({ keyword: ' ' }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'keyword is required',
    })
    expect(state.spawnSync).not.toHaveBeenCalled()
  })

  it('requires JSON content type before parsing the search body', async () => {
    const response = await post({
      request: new Request('http://localhost/api/telegram-find', {
        method: 'POST',
        body: JSON.stringify({ keyword: 'budget' }),
      }),
    })

    expect(response.status).toBe(415)
    expect(state.spawnSync).not.toHaveBeenCalled()
  })

  it('returns count and message after sending search results', async () => {
    state.tasks = [
      {
        id: 'task-1',
        title: 'Review budget',
        description: 'Monthly check',
        tags: ['finance'],
        column: 'todo',
      },
    ]

    const response = await post({
      request: request({ keyword: 'budget', chat_id: '42' }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      count: 1,
      message: expect.stringContaining('Review budget'),
    })
    expect(state.spawnSync).toHaveBeenCalledWith(
      'hermes',
      expect.arrayContaining(['--to', 'telegram:42']),
      expect.any(Object),
    )
  })
})
