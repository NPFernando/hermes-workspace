import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  getClientIp,
  MAX_SAFE_ERROR_MESSAGE_LENGTH,
  rateLimit,
  rateLimitResponse,
  redactSensitiveErrorMessage,
  requireJsonContentType,
} from './rate-limit'

describe('rate-limit helpers', () => {
  it('uses the request remote address unless proxy trust is enabled', () => {
    const request = new Request('http://localhost')
    Object.defineProperty(request, 'remoteAddress', { value: '10.0.0.7' })
    request.headers.set('x-forwarded-for', '203.0.113.10')

    const previous = process.env.TRUST_PROXY
    delete process.env.TRUST_PROXY
    expect(getClientIp(request)).toBe('10.0.0.7')

    process.env.TRUST_PROXY = '1'
    expect(getClientIp(request)).toBe('203.0.113.10')

    if (previous === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = previous
  })

  it('allows requests up to the configured limit and rejects the next one', () => {
    const key = `rate-limit-test:${randomUUID()}`
    expect(rateLimit(key, 2, 60_000)).toBe(true)
    expect(rateLimit(key, 2, 60_000)).toBe(true)
    expect(rateLimit(key, 2, 60_000)).toBe(false)
  })

  it('requires JSON content type for state-changing requests', () => {
    expect(requireJsonContentType(new Request('http://localhost'))).toBeNull()
    expect(
      requireJsonContentType(
        new Request('http://localhost', { method: 'POST' }),
      ),
    ).toBeInstanceOf(Response)
    expect(
      requireJsonContentType(
        new Request('http://localhost', {
          method: 'POST',
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
      ),
    ).toBeNull()
  })

  it('returns a JSON 429 response', async () => {
    const response = rateLimitResponse()
    expect(response.status).toBe(429)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('retry-after')).toBe('60')
    expect(await response.json()).toEqual({
      error: 'Too many requests, please try again later',
    })
  })

  it('redacts common credentials from development error messages', () => {
    const message = redactSensitiveErrorMessage(
      'request failed api_key=sk-live-secret Bearer abc.def password="open-sesame" https://user:pw@example.test/api',
    )
    expect(message).not.toContain('sk-live-secret')
    expect(message).not.toContain('abc.def')
    expect(message).not.toContain('open-sesame')
    expect(message).not.toContain('user:pw@example.test')
    expect(message).toContain('api_key=[REDACTED]')
    expect(message).toContain('Bearer [REDACTED]')
  })

  it('caps oversized diagnostics after redaction', () => {
    const message = redactSensitiveErrorMessage('x'.repeat(2_000))
    expect(message).toHaveLength(MAX_SAFE_ERROR_MESSAGE_LENGTH)
    expect(message.endsWith('…')).toBe(true)
  })
})
