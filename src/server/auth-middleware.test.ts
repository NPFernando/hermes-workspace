import { readFile, rm, stat, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  delete process.env.CLAUDE_PASSWORD
  delete process.env.HERMES_HOME
  delete process.env.HERMES_SESSION_IDLE_TIMEOUT_MS
})

afterEach(() => {
  delete process.env.COOKIE_SECURE
  delete process.env.NODE_ENV
  delete process.env.TRUST_PROXY
  delete process.env.CLAUDE_PASSWORD
  delete process.env.HERMES_HOME
  delete process.env.HERMES_SESSION_IDLE_TIMEOUT_MS
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
    expect(ip).toBe('unknown')
  })

  it('ignores x-real-ip when TRUST_PROXY is unset', async () => {
    delete process.env.TRUST_PROXY
    const { getRequestIp } = await import('./auth-middleware')
    const ip = getRequestIp(makeRequest({ 'x-real-ip': '203.0.113.77' }))
    expect(ip).toBe('unknown')
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

  it('uses adapter-provided socket metadata when proxy trust is disabled', async () => {
    const { getRequestIp } = await import('./auth-middleware')
    const request = makeRequest({})
    Object.defineProperty(request, 'remoteAddress', {
      value: '203.0.113.77',
    })
    expect(getRequestIp(request)).toBe('203.0.113.77')
  })
})

describe('authorization policy', () => {
  function makeRequest(
    headers: Record<string, string> = {},
    remoteAddress?: string,
  ): Request {
    const request = new Request('http://workspace.test/api/control-plane', {
      headers,
    })
    if (remoteAddress) {
      Object.defineProperty(request, 'remoteAddress', {
        value: remoteAddress,
      })
    }
    return request
  }

  it('allows requests when password protection is disabled', async () => {
    const { isAuthenticated } = await import('./auth-middleware')
    expect(isAuthenticated(makeRequest())).toBe(true)
  })

  it('rejects unauthenticated requests when a password is configured', async () => {
    process.env.HERMES_PASSWORD = 'configured-test-password'
    const { isAuthenticated } = await import('./auth-middleware')
    expect(isAuthenticated(makeRequest())).toBe(false)
  })

  it('allows local automation and rejects forwarded public callers', async () => {
    process.env.TRUST_PROXY = '1'
    const { requireLocalOrAuth } = await import('./auth-middleware')

    expect(requireLocalOrAuth(makeRequest({}, '127.0.0.1'))).toBe(true)
    expect(
      requireLocalOrAuth(makeRequest({ 'x-forwarded-for': '203.0.113.77' })),
    ).toBe(false)
  })

  it('allows local automation when a password is configured', async () => {
    process.env.HERMES_PASSWORD = 'configured-test-password'
    process.env.TRUST_PROXY = '1'
    const { requireLocalOrAuth } = await import('./auth-middleware')
    expect(requireLocalOrAuth(makeRequest({}, '127.0.0.1'))).toBe(true)
    expect(
      requireLocalOrAuth(makeRequest({ 'x-forwarded-for': '203.0.113.77' })),
    ).toBe(false)
  })
})

describe('session store persistence', () => {
  it('writes a valid private store through an atomic replacement path', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hermes-auth-store-'))
    process.env.HERMES_HOME = home
    try {
      const { generateSessionToken, storeSessionToken } =
        await import('./auth-middleware')
      const token = generateSessionToken()
      storeSessionToken(token, false)

      const storePath = join(home, 'workspace-sessions.json')
      const parsed = JSON.parse(await readFile(storePath, 'utf8')) as {
        tokens: Record<string, number>
        lastSeen: Record<string, number>
      }
      expect(parsed.tokens[token]).toBeGreaterThan(Date.now())
      expect(parsed.lastSeen[token]).toBeLessThanOrEqual(Date.now())
      expect((await stat(storePath)).mode & 0o777).toBe(0o600)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('expires an inactive token while preserving absolute expiry semantics', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hermes-auth-store-idle-'))
    process.env.HERMES_HOME = home
    process.env.HERMES_SESSION_IDLE_TIMEOUT_MS = '1000'
    vi.useFakeTimers()
    try {
      const { generateSessionToken, isValidSessionToken, storeSessionToken } =
        await import('./auth-middleware')
      const token = generateSessionToken()
      storeSessionToken(token, false)
      expect(isValidSessionToken(token)).toBe(true)

      vi.advanceTimersByTime(1001)
      expect(isValidSessionToken(token)).toBe(false)
    } finally {
      vi.useRealTimers()
      await rm(home, { recursive: true, force: true })
    }
  })

  it('bounds active persisted sessions and evicts the oldest token first', async () => {
    const home = await mkdtemp(join(tmpdir(), 'hermes-auth-store-cap-'))
    process.env.HERMES_HOME = home
    try {
      const { generateSessionToken, MAX_SESSION_TOKENS, storeSessionToken } =
        await import('./auth-middleware')
      const tokens = Array.from({ length: MAX_SESSION_TOKENS + 1 }, () =>
        generateSessionToken(),
      )
      for (const token of tokens) storeSessionToken(token, false)

      const storePath = join(home, 'workspace-sessions.json')
      const parsed = JSON.parse(await readFile(storePath, 'utf8')) as {
        tokens: Record<string, number>
      }
      expect(Object.keys(parsed.tokens)).toHaveLength(MAX_SESSION_TOKENS)
      expect(parsed.tokens[tokens[0]]).toBeUndefined()
      expect(parsed.tokens[tokens.at(-1)!]).toBeGreaterThan(Date.now())
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
