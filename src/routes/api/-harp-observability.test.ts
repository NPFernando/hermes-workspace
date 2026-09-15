import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ authenticated: false }))
const reads = vi.hoisted(() => ({
  observability: vi.fn(),
  readiness: vi.fn(),
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => state.authenticated),
}))
vi.mock('../../server/harp-observability', () => ({
  getHarpObservabilityView: reads.observability,
}))
vi.mock('../../server/harp-memory-client', () => ({
  getHarpReadiness: reads.readiness,
}))

import { Route } from './harp-observability'

type RouteHandlers = {
  GET: (ctx: { request: Request }) => Promise<Response>
}

const handlers = (
  Route as unknown as { options: { server: { handlers: RouteHandlers } } }
).options.server.handlers

beforeEach(() => {
  state.authenticated = false
  reads.observability.mockReset()
  reads.readiness.mockReset()
})

describe('HARP observability and readiness API', () => {
  it('requires authentication before reading either source', async () => {
    const response = await handlers.GET({
      request: new Request('http://localhost/api/harp-observability'),
    })

    expect(response.status).toBe(401)
    expect(reads.observability).not.toHaveBeenCalled()
    expect(reads.readiness).not.toHaveBeenCalled()
  })

  it('returns routing telemetry and a distinct readiness report when authenticated', async () => {
    state.authenticated = true
    reads.observability.mockReturnValue({ decisionSummary: { total: 0 } })
    reads.readiness.mockResolvedValue({
      available: true,
      repositoryPath: '/workspace/harp',
      checkedAt: 10,
      report: {
        status: 'ready_for_review',
        blockers: [],
        execution_enabled: false,
        side_effects: false,
      },
    })

    const response = await handlers.GET({
      request: new Request('http://localhost/api/harp-observability'),
    })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      ok: true,
      decisionSummary: { total: 0 },
      readiness: {
        available: true,
        report: {
          status: 'ready_for_review',
          execution_enabled: false,
          side_effects: false,
        },
      },
    })
  })
})
