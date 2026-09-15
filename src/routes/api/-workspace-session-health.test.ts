import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './workspace-session-health'

const state = vi.hoisted(() => ({ authenticated: false }))
const read = vi.hoisted(() => vi.fn())

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => state.authenticated),
}))
vi.mock('../../server/workspace-session-health', () => ({
  getWorkspaceSessionHealth: read,
}))

type RouteHandlers = {
  GET: (ctx: { request: Request }) => Promise<Response>
}

const handlers = (
  Route as unknown as { options: { server: { handlers: RouteHandlers } } }
).options.server.handlers

beforeEach(() => {
  state.authenticated = false
  read.mockReset()
})

describe('workspace session health API', () => {
  it('requires authentication before probing local sessions', async () => {
    const response = await handlers.GET({
      request: new Request('http://localhost/api/workspace-session-health'),
    })

    expect(response.status).toBe(401)
    expect(read).not.toHaveBeenCalled()
  })

  it('returns read-only heartbeat facts without claiming agent response', async () => {
    state.authenticated = true
    read.mockResolvedValue({
      available: true,
      checkedAt: 1,
      reason: 'ready',
      installation: { installedExecutable: true, packageVersion: '0.2.0' },
      probeProcess: {
        alive: true,
        pid: 1234,
        role: 'live-state CLI probe',
      },
      sessions: [
        {
          name: 'codex-main',
          attached: true,
          paneProcessAlive: true,
          paneDead: false,
          tuiResponsive: true,
          heartbeatLatencyMs: 12,
          keysSent: false,
        },
      ],
    })

    const response = await handlers.GET({
      request: new Request('http://localhost/api/workspace-session-health'),
    })
    const body = await response.json()

    expect(body).toMatchObject({
      ok: true,
      installation: { installedExecutable: true },
      sessions: [{ name: 'codex-main', attached: true, keysSent: false }],
    })
    expect(body.sessions[0]).not.toHaveProperty('agentResponded')
  })
})
