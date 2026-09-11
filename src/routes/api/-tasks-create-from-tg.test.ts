import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  allowed: true,
  generateTaskFromText: vi.fn(),
  createTask: vi.fn(),
  spawnSync: vi.fn(),
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
vi.mock('../../server/astra-tasks', () => ({
  generateTaskFromText: state.generateTaskFromText,
}))
vi.mock('../../server/tasks-store', () => ({ createTask: state.createTask }))
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

const { Route } = await import('./tasks-create-from-tg')
const post = (
  Route as unknown as {
    server: {
      handlers: { POST: (input: { request: Request }) => Promise<Response> }
    }
  }
).server.handlers.POST

function request(body: unknown): Request {
  return new Request('http://localhost/api/tasks-create-from-tg', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/tasks-create-from-tg', () => {
  it('requires local access or authentication', async () => {
    state.authenticated = false
    const response = await post({ request: request({ text: 'new task' }) })

    expect(response.status).toBe(401)
    expect(state.generateTaskFromText).not.toHaveBeenCalled()
    state.authenticated = true
  })

  it('rejects missing task text before invoking the parser', async () => {
    const response = await post({ request: request({ text: '   ' }) })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'text is required',
    })
    expect(state.generateTaskFromText).not.toHaveBeenCalled()
  })

  it('creates a task and returns the stable Telegram response shape', async () => {
    state.generateTaskFromText.mockResolvedValueOnce({
      title: 'Review budget',
      description: 'Check this month',
      priority: 'medium',
    })
    state.createTask.mockReturnValueOnce({
      id: 'task-1',
      title: 'Review budget',
      priority: 'high',
      column: 'todo',
      description: 'Check this month',
    })
    state.spawnSync.mockReturnValue({ status: 0 })

    const response = await post({
      request: request({
        text: 'review budget',
        priority: 'high',
        chat_id: '42',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      task: {
        id: 'task-1',
        title: 'Review budget',
        priority: 'high',
        column: 'todo',
      },
    })
    expect(state.spawnSync).toHaveBeenCalledWith(
      'hermes',
      expect.arrayContaining(['--to', 'telegram:42']),
      expect.any(Object),
    )
  })
})
