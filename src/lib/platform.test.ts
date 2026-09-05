import { describe, expect, it } from 'vitest'

import { detectIsMac } from './platform'

describe('detectIsMac', () => {
  it('detects macOS user agents', () => {
    expect(
      detectIsMac({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      }),
    ).toBe(true)
  })

  it('detects iOS devices', () => {
    expect(
      detectIsMac({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      }),
    ).toBe(true)
    expect(
      detectIsMac({
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)',
      }),
    ).toBe(true)
  })

  it('returns false for Windows and Linux', () => {
    expect(
      detectIsMac({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      }),
    ).toBe(false)
    expect(
      detectIsMac({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
      }),
    ).toBe(false)
  })

  it('returns false when navigator is unavailable (SSR)', () => {
    expect(detectIsMac(undefined)).toBe(false)
  })
})
