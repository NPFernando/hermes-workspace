import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for #123 (Secure cookie attribute) and #125
 * (x-forwarded-for spoofing).
 *
 * We reset the module between tests because the cookie helper captures
 * env-dependent state at call time and rate-limit / middleware paths
 * depend on `TRUST_PROXY`.
 */

beforeEach(() => {
  vi.resetModules()
  delete process.env.COOKIE_SECURE
  delete process.env.NODE_ENV
  delete process.env.TRUST_PROXY
  delete process.env.HERMES_PASSWORD
  delete process.env.HERMES_E2E_PASSWORD
  delete process.env.HERMES_AUTH_FAILURE_LOG
  delete process.env.CLAUDE_PASSWORD
  delete process.env.HERMES_AUTH_FAILURE_LOG
  delete process.env.HERMES_E2E_PASSWORD
})

afterEach(() => {
  delete process.env.COOKIE_SECURE
  delete process.env.NODE_ENV
  delete process.env.TRUST_PROXY
  delete process.env.CLAUDE_PASSWORD
})

describe('createSessionCookie (#123)', () => {
  it('omits Secure in development by default', async () => {
    process.env.NODE_ENV = 'development'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toMatch(/^claude-auth=tok123/)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Secure')
  })

  it('sets Secure in production by default', async () => {
    process.env.NODE_ENV = 'production'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
  })

  it('respects COOKIE_SECURE=1 override in development', async () => {
    process.env.NODE_ENV = 'development'
    process.env.COOKIE_SECURE = '1'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).toContain('Secure')
  })

  it('respects COOKIE_SECURE=0 override in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.COOKIE_SECURE = '0'
    const { createSessionCookie } = await import('./auth-middleware')
    const cookie = createSessionCookie('tok123')
    expect(cookie).not.toContain('Secure')
  })
})

describe('getRequestIp (#125)', () => {
  function makeRequest(headers: Record<string, string>): Request {
    return new Request('http://localhost/', { headers })
  }

  it('ignores x-forwarded-for when TRUST_PROXY is unset', async () => {
    delete process.env.TRUST_PROXY
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(
      makeRequest({ 'x-forwarded-for': '203.0.113.77, 10.0.0.1' }),
    )
    expect(ip).toBe('127.0.0.1')
  })

  it('ignores x-real-ip when TRUST_PROXY is unset', async () => {
    delete process.env.TRUST_PROXY
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(makeRequest({ 'x-real-ip': '203.0.113.77' }))
    expect(ip).toBe('127.0.0.1')
  })

  it('honors x-forwarded-for when TRUST_PROXY=1', async () => {
    process.env.TRUST_PROXY = '1'
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(
      makeRequest({ 'x-forwarded-for': '203.0.113.77, 10.0.0.1' }),
    )
    expect(ip).toBe('203.0.113.77')
  })

  it('honors x-real-ip fallback when TRUST_PROXY=true and x-forwarded-for absent', async () => {
    process.env.TRUST_PROXY = 'true'
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(makeRequest({ 'x-real-ip': '198.51.100.5' }))
    expect(ip).toBe('198.51.100.5')
  })
})

describe('authentication observability', () => {
  it('accepts safe request IDs and replaces unsafe or oversized values', async () => {
    const { getRequestCorrelationId } = await import('./auth-middleware')
    expect(
      getRequestCorrelationId(
        new Request('http://localhost/', { headers: { 'x-request-id': 'deploy-123' } }),
      ),
    ).toBe('deploy-123')
    expect(
      getRequestCorrelationId(
        new Request('http://localhost/', { headers: { 'x-request-id': 'bad id' } }),
      ),
    ).toMatch(/^[0-9a-f-]{36}$/)
  })
})

describe('dedicated read-only E2E authentication', () => {
  it('does not grant the E2E credential access to mutating requests', async () => {
    process.env.HERMES_PASSWORD = 'high-privilege-workspace-secret'
    process.env.HERMES_E2E_PASSWORD = 'separate-readonly-e2e-secret'
    const {
      generateSessionToken,
      isAuthenticated,
      passwordRole,
      storeSessionToken,
    } = await import('./auth-middleware')

    expect(passwordRole(process.env.HERMES_E2E_PASSWORD)).toBe('e2e-readonly')
    expect(passwordRole(process.env.HERMES_PASSWORD)).toBe('full')
    expect(passwordRole('wrong-secret')).toBeNull()

    const token = generateSessionToken()
    storeSessionToken(token, false, 'e2e-readonly')
    expect(
      isAuthenticated(new Request('http://localhost/api/auth-check', {
        method: 'GET',
        headers: { cookie: `claude-auth=${token}` },
      })),
    ).toBe(true)
    expect(
      isAuthenticated(new Request('http://localhost/api/send', {
        method: 'POST',
        headers: { cookie: `claude-auth=${token}` },
      })),
    ).toBe(false)
  })
})
