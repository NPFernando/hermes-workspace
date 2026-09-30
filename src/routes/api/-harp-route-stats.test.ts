import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { loadHarpRouteStats } from '../../server/harp-route-stats'
import { Route } from './harp-route-stats'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))
vi.mock('../../server/harp-route-stats', async (importActual) => ({
  ...(await importActual<typeof import('../../server/harp-route-stats')>()),
  loadHarpRouteStats: vi.fn(),
}))

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: { GET: (ctx: { request: Request }) => Promise<Response> }
    }
  }
}

const handler = (Route as RouteWithHandlers).options.server.handlers.GET
const url = 'http://localhost/api/harp-route-stats'

beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('GET /api/harp-route-stats', () => {
  it('requires dashboard authentication before running harp', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)
    const response = await handler({ request: new Request(url) })
    expect(response.status).toBe(401)
    expect(loadHarpRouteStats).not.toHaveBeenCalled()
  })

  it('returns stats for the clamped window', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(loadHarpRouteStats).mockResolvedValue({
      window_days: 7,
      outcomes: 0,
      min_samples: 5,
      demote_below: 0.5,
      routes: [],
      classifier: { agreed: 0, corrected: 0, accuracy: null },
    })
    const response = await handler({ request: new Request(`${url}?days=7`) })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, outcomes: 0 })
    expect(loadHarpRouteStats).toHaveBeenCalledWith(7)
  })

  it('returns 503 without leaking error details', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(loadHarpRouteStats).mockRejectedValue(new Error('secret path'))
    const response = await handler({ request: new Request(url) })
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('secret path')
  })
})
