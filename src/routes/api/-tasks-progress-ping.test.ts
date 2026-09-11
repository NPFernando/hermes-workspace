import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  allowed: true,
  tasks: [] as Array<Record<string, unknown>>,
  updateTask: vi.fn(),
  sendTelegramProgressPing: vi.fn(async () => undefined),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))
vi.mock('../../server/auth-middleware', () => ({
  requireLocalOrAuth: () => state.authenticated,
}))
vi.mock('../../server/tasks-store', () => ({
  listTasks: () => state.tasks,
  updateTask: state.updateTask,
}))
vi.mock('../../server/telegram-clarify', () => ({
  sendTelegramProgressPing: state.sendTelegramProgressPing,
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

const { Route } = await import('./tasks-progress-ping')
const post = (
  Route as unknown as {
    server: {
      handlers: { POST: (input: { request: Request }) => Promise<Response> }
    }
  }
).server.handlers.POST

function request(): Request {
  return new Request('http://localhost/api/tasks-progress-ping', {
    method: 'POST',
  })
}

describe('POST /api/tasks-progress-ping', () => {
  it('requires local access or authentication', async () => {
    state.authenticated = false
    const response = await post({ request: request() })

    expect(response.status).toBe(401)
    expect(state.sendTelegramProgressPing).not.toHaveBeenCalled()
    state.authenticated = true
  })

  it('rate-limits before scanning tasks', async () => {
    state.allowed = false
    const response = await post({ request: request() })

    expect(response.status).toBe(429)
    expect(state.sendTelegramProgressPing).not.toHaveBeenCalled()
    state.allowed = true
  })

  it('pings eligible working tasks and skips early or near-timeout work', async () => {
    const now = Date.now()
    state.tasks = [
      {
        id: 'eligible',
        title: 'Eligible task',
        agent_name: 'ada',
        agent_state: 'working',
        agent_action_at: new Date(now - 4 * 60_000).toISOString(),
      },
      {
        id: 'too-early',
        title: 'Too early',
        agent_state: 'working',
        agent_action_at: new Date(now - 60_000).toISOString(),
      },
      {
        id: 'near-timeout',
        title: 'Near timeout',
        agent_state: 'working',
        agent_action_at: new Date(now - 19 * 60_000).toISOString(),
      },
      {
        id: 'idle',
        title: 'Idle',
        agent_state: null,
        agent_action_at: new Date(now - 4 * 60_000).toISOString(),
      },
    ]

    const response = await post({ request: request() })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pinged: 1,
      tasks: [{ id: 'eligible', title: 'Eligible task' }],
    })
    expect(state.sendTelegramProgressPing).toHaveBeenCalledWith(
      { id: 'eligible', title: 'Eligible task', agent_name: 'ada' },
      expect.any(Number),
    )
    expect(state.updateTask).toHaveBeenCalledWith(
      'eligible',
      expect.objectContaining({ agent_progress_pinged_at: expect.any(String) }),
    )
  })
})
