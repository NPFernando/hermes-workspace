import { describe, expect, it } from 'vitest'
import { validateSessionSendInput } from './session-send'

describe('session-send input validation', () => {
  it('trims and accepts a normal message', () => {
    expect(
      validateSessionSendInput({ sessionKey: '  session-1 ', message: ' hi ' }),
    ).toEqual({ ok: true, input: { sessionKey: 'session-1', message: 'hi' } })
  })

  it('rejects non-object and non-string input safely', () => {
    expect(validateSessionSendInput(null)).toEqual({
      ok: false,
      error: 'Invalid request body',
    })
    expect(validateSessionSendInput({ sessionKey: 1, message: true })).toEqual({
      ok: false,
      error: 'sessionKey is required',
    })
  })

  it('rejects oversized session keys and messages', () => {
    expect(
      validateSessionSendInput({ sessionKey: 'x'.repeat(513), message: 'ok' }),
    ).toEqual({ ok: false, error: 'sessionKey is too long' })
    expect(
      validateSessionSendInput({
        sessionKey: 'session-1',
        message: 'x'.repeat(200_001),
      }),
    ).toEqual({ ok: false, error: 'message is too long' })
  })
})
