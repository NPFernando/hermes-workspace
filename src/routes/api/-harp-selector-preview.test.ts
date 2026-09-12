import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isAuthenticated } from '../../server/auth-middleware'
import { loadHarpSelectorPreview } from '../../server/harp-selector-preview'
import { Route } from './harp-selector-preview'

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(),
}))
vi.mock('../../server/harp-selector-preview', () => ({
  loadHarpSelectorPreview: vi.fn(),
}))

type RouteWithHandlers = typeof Route & {
  options: {
    server: {
      handlers: { GET: (ctx: { request: Request }) => Promise<Response> }
    }
  }
}

const handler = (Route as RouteWithHandlers).options.server.handlers.GET

beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.restoreAllMocks())

describe('GET /api/harp-selector-preview', () => {
  it('requires dashboard authentication before contacting the local selector', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(false)
    const response = await handler({
      request: new Request('http://localhost/api/harp-selector-preview'),
    })

    expect(response.status).toBe(401)
    expect(loadHarpSelectorPreview).not.toHaveBeenCalled()
  })

  it('returns the read-only preview for an authenticated dashboard session', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(loadHarpSelectorPreview).mockResolvedValue({
      tasks: ['code_review'],
      risks: ['standard'],
      generated_at: '2026-09-12T00:00:00Z',
      matrix: [
        {
          risk: 'standard',
          cells: [
            {
              available: true,
              provider: 'openai-codex',
              model: 'gpt-5.5',
              tier: 'subscription',
              decision: 'phase_enforced',
            },
          ],
        },
      ],
    })

    const response = await handler({
      request: new Request('http://localhost/api/harp-selector-preview'),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, risks: ['standard'] })
  })

  it('returns a stable unavailable response without leaking upstream errors', async () => {
    vi.mocked(isAuthenticated).mockReturnValue(true)
    vi.mocked(loadHarpSelectorPreview).mockRejectedValue(
      new Error('/private/path/selector failure'),
    )

    const response = await handler({
      request: new Request('http://localhost/api/harp-selector-preview'),
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      ok: false,
      error: 'HARP selector preview is unavailable',
    })
  })
})
