import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './auth-check'

const state = vi.hoisted(() => ({ authenticated: false }))
const probe = vi.hoisted(() => vi.fn())

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => state.authenticated),
  isPasswordProtectionEnabled: vi.fn(() => true),
}))
vi.mock('../../server/gateway-capabilities', () => ({
  ensureGatewayProbed: probe,
}))

type RouteHandlers = {
  GET: (ctx: { request: Request }) => Promise<Response>
}

const handlers = (
  Route as unknown as { options: { server: { handlers: RouteHandlers } } }
).options.server.handlers

beforeEach(() => {
  state.authenticated = false
  probe.mockReset()
  probe.mockResolvedValue({ health: true })
})

describe('auth-check API', () => {
  it('returns authenticated state without waiting for a slow gateway probe', async () => {
    let resolveProbe!: (value: unknown) => void
    probe.mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve
      }),
    )
    state.authenticated = true

    const response = await handlers.GET({
      request: new Request('http://localhost/api/auth-check'),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authenticated: true,
      authRequired: true,
    })
    expect(probe).toHaveBeenCalledOnce()
    resolveProbe({ health: true })
  })

  it('rejects unauthenticated requests without probing the gateway', async () => {
    const response = await handlers.GET({
      request: new Request('http://localhost/api/auth-check'),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authenticated: false,
      authRequired: true,
    })
    expect(probe).not.toHaveBeenCalled()
  })
})
