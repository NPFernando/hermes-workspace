import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './auth-check'

const state = vi.hoisted(() => ({ authenticated: false }))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => state.authenticated),
  isPasswordProtectionEnabled: vi.fn(() => true),
}))

type RouteHandlers = {
  GET: (ctx: { request: Request }) => Promise<Response>
}

const handlers = (
  Route as unknown as { options: { server: { handlers: RouteHandlers } } }
).options.server.handlers

beforeEach(() => {
  state.authenticated = false
})

describe('auth-check API', () => {
  it('returns authenticated state without probing gateway health', async () => {
    state.authenticated = true

    const response = await handlers.GET({
      request: new Request('http://localhost/api/auth-check'),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authenticated: true,
      authRequired: true,
    })
  })

  it('does not probe gateway health for unauthenticated requests', async () => {
    const response = await handlers.GET({
      request: new Request('http://localhost/api/auth-check'),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      authenticated: false,
      authRequired: true,
    })
  })
})
