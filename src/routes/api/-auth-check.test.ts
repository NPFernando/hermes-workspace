import { describe, expect, it, vi } from 'vitest'

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

vi.mock('../../server/gateway-capabilities', () => ({
  ensureGatewayProbed: vi.fn(),
}))

vi.mock('../../server/auth-middleware', () => ({
  isAuthenticated: vi.fn(() => true),
  isPasswordProtectionEnabled: vi.fn(() => false),
}))

describe('/api/auth-check cache policy', () => {
  it('marks auth responses private and varies them by cookie', async () => {
    const { authCheckResponse } = await import('./auth-check')
    const response = authCheckResponse({
      authenticated: true,
      authRequired: false,
    })

    expect(response.headers.get('cache-control')).toBe(
      'no-store, no-cache, must-revalidate, private',
    )
    expect(response.headers.get('vary')).toBe('Cookie')
  })
})
