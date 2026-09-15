import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Route } from './provider-usage'

const state = vi.hoisted(() => ({ authenticated: false }))
const getUsage = vi.hoisted(() => vi.fn())
const getUsageHistory = vi.hoisted(() => vi.fn(() => []))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => state.authenticated),
}))
vi.mock('../../server/provider-usage', () => ({
  getProviderUsage: getUsage,
}))
vi.mock('../../server/provider-usage-history', () => ({
  recordAndReadProviderUsageHistory: getUsageHistory,
}))

type RouteHandlers = {
  GET: (ctx: { request: Request }) => Promise<Response>
}

const handlers = (
  Route as unknown as { options: { server: { handlers: RouteHandlers } } }
).options.server.handlers

beforeEach(() => {
  state.authenticated = false
  getUsage.mockReset()
  getUsageHistory.mockReset()
  getUsageHistory.mockReturnValue([])
})

describe('provider usage API authentication and provenance', () => {
  it('rejects anonymous usage reads before polling provider sources', async () => {
    const response = await handlers.GET({
      request: new Request('http://localhost/api/provider-usage'),
    })

    expect(response.status).toBe(401)
    expect(getUsage).not.toHaveBeenCalled()
  })

  it('returns provider usage with its source and measurement classification', async () => {
    state.authenticated = true
    getUsage.mockResolvedValue({
      ok: true,
      updatedAt: 10,
      providers: [
        {
          provider: 'openrouter',
          source: 'GET /api/v1/key',
          sourceKind: 'provider_api',
          updatedAt: 10,
          lines: [{ label: 'Spend limit', measure: 'spend' }],
        },
      ],
    })

    const response = await handlers.GET({
      request: new Request('http://localhost/api/provider-usage?force=1'),
    })
    const payload = await response.json()

    expect(getUsage).toHaveBeenCalledWith(true)
    expect(payload.providers[0]).toMatchObject({
      sourceKind: 'provider_api',
      source: 'GET /api/v1/key',
      lines: [{ measure: 'spend' }],
    })
    expect(getUsageHistory).toHaveBeenCalledWith([
      expect.objectContaining({ provider: 'openrouter' }),
    ])
    expect(payload.history).toEqual([])
  })

  it('keeps provider readings available when optional history storage fails', async () => {
    state.authenticated = true
    getUsage.mockResolvedValue({ ok: true, updatedAt: 10, providers: [] })
    getUsageHistory.mockImplementation(() => {
      throw new Error('history database unavailable')
    })

    const response = await handlers.GET({
      request: new Request('http://localhost/api/provider-usage'),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ ok: true, providers: [], history: [] })
  })
})
