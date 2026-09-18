import { describe, expect, it } from 'vitest'
import {
  ExternalWriteBlockedError,
  assertExternalWritesEnabled,
  getSafeModeStatus,
  isSafeModeEnabled,
} from './safe-mode'

describe('safe mode', () => {
  it('recognises explicit operator-enabled values only', () => {
    expect(isSafeModeEnabled({ HERMES_SAFE_MODE: '1' })).toBe(true)
    expect(isSafeModeEnabled({ HERMES_SAFE_MODE: 'yes' })).toBe(true)
    expect(isSafeModeEnabled({ HERMES_SAFE_MODE: 'false' })).toBe(false)
    expect(isSafeModeEnabled({})).toBe(false)
  })

  it('blocks external writes without affecting status reads', () => {
    expect(getSafeModeStatus({ HERMES_SAFE_MODE: 'on' })).toMatchObject({
      enabled: true,
      source: 'HERMES_SAFE_MODE',
    })
    expect(() =>
      assertExternalWritesEnabled('Dify workflow run', {
        HERMES_SAFE_MODE: 'true',
      }),
    ).toThrow(ExternalWriteBlockedError)
    expect(() =>
      assertExternalWritesEnabled('preview', { HERMES_SAFE_MODE: 'true' }),
    ).toThrow(/external write blocked/)
    expect(() =>
      assertExternalWritesEnabled('Dify workflow run', {
        HERMES_SAFE_MODE: '0',
      }),
    ).not.toThrow()
  })
})
