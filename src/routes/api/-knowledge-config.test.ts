import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  authenticated: true,
  contentTypeError: null as Response | null,
  allowed: true,
  write: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => options,
}))
vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: () => state.authenticated,
}))
vi.mock('../../server/rate-limit', () => ({
  getClientIp: () => '127.0.0.1',
  rateLimit: () => state.allowed,
  rateLimitResponse: () =>
    new Response(JSON.stringify({ ok: false, error: 'Too many requests' }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    }),
  requireJsonContentType: () => state.contentTypeError,
  safeErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : 'Unknown error',
}))
vi.mock('../../server/knowledge-config', () => ({
  readKnowledgeBaseConfig: vi.fn(() => ({ source: 'wiki' })),
  writeKnowledgeBaseConfig: state.write,
}))

const { Route } = await import('./knowledge/config')
const post = (
  Route as unknown as {
    server: {
      handlers: { POST: (input: { request: Request }) => Promise<Response> }
    }
  }
).server.handlers.POST

function request(body: unknown): Request {
  return new Request('http://localhost/api/knowledge/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/knowledge/config', () => {
  it('rejects non-JSON requests before reading configuration', async () => {
    state.contentTypeError = new Response(
      JSON.stringify({ ok: false, error: 'JSON content type required' }),
      { status: 415, headers: { 'content-type': 'application/json' } },
    )

    const response = await post({ request: request({ source: 'wiki' }) })

    expect(response.status).toBe(415)
    expect(state.write).not.toHaveBeenCalled()
    state.contentTypeError = null
  })

  it('rate-limits before writing configuration', async () => {
    state.allowed = false

    const response = await post({ request: request({ source: 'wiki' }) })

    expect(response.status).toBe(429)
    expect(state.write).not.toHaveBeenCalled()
    state.allowed = true
  })
})
