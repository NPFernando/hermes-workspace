import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearOAuthStateCookie,
  createOAuthStateCookie,
  getOAuthStateCookie,
  storeOAuthState,
  consumeOAuthState,
} from './google-oauth'

describe('OAuth state browser binding', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'production'
    delete process.env.COOKIE_SECURE
  })

  afterEach(() => {
    delete process.env.NODE_ENV
    delete process.env.COOKIE_SECURE
  })

  it('creates a short-lived HttpOnly SameSite=Lax cookie and parses it', () => {
    const cookie = createOAuthStateCookie('state+/=value')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/api/auth')
    expect(cookie).toContain('Max-Age=600')
    expect(cookie).toContain('Secure')
    expect(getOAuthStateCookie(cookie)).toBe('state+/=value')
  })

  it('clears the binding cookie and rejects malformed values', () => {
    expect(clearOAuthStateCookie()).toContain('Max-Age=0')
    expect(getOAuthStateCookie('hermes-oauth-state=%E0%A4%A')).toBeNull()
    expect(getOAuthStateCookie('other=value')).toBeNull()
  })

  it('bounds the in-memory state store and evicts the oldest entries', () => {
    storeOAuthState('bounded-oldest')
    for (let index = 0; index < 1_000; index += 1) {
      storeOAuthState(`bounded-${index}`)
    }

    expect(consumeOAuthState('bounded-oldest')).toBeNull()
    expect(consumeOAuthState('bounded-999')).toBe('login')
  })
})
