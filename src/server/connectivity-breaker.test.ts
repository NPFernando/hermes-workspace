import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

// Same isolation pattern as demo-trading-engine.test.ts — the finance store
// resolves its path from os.homedir() at module load, so point HOME at a
// temp dir and reset modules so the store re-evaluates against it.
let tmp: string
let realHome: string | undefined
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'connectivity-breaker-'))
  realHome = process.env.HOME
  process.env.HOME = tmp
  vi.resetModules()
})
afterEach(() => {
  if (realHome === undefined) delete process.env.HOME
  else process.env.HOME = realHome
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('isCredentialFailureMessage', () => {
  it('matches HTTP 401/403 and known Binance credential codes', async () => {
    const { isCredentialFailureMessage } = await import('./connectivity-breaker')
    expect(isCredentialFailureMessage('Binance demo /api/v3/account failed (401): Unauthorized')).toBe(true)
    expect(isCredentialFailureMessage('Binance demo /api/v3/order failed (403): Forbidden')).toBe(true)
    expect(isCredentialFailureMessage('Binance demo /api/v3/order failed (400 code -2014): API-key format invalid.')).toBe(true)
    expect(isCredentialFailureMessage('Binance demo /api/v3/order failed (400 code -2015): Invalid API-key, IP, or permissions for action.')).toBe(true)
    expect(isCredentialFailureMessage('Binance demo /api/v3/order failed (400 code -1022): Signature for this request is not valid.')).toBe(true)
  })

  it('does not match transient/rate-limit/network errors', async () => {
    const { isCredentialFailureMessage } = await import('./connectivity-breaker')
    expect(isCredentialFailureMessage('Binance demo /api/v3/order failed (429 code -1003): Too many requests.')).toBe(false)
    expect(isCredentialFailureMessage('price BTCUSDT failed (500)')).toBe(false)
    expect(isCredentialFailureMessage('klines BTCUSDT failed (503)')).toBe(false)
    expect(isCredentialFailureMessage('fetch failed: ETIMEDOUT')).toBe(false)
  })
})

describe('recordConnectivityOutcome / isConnectivityBreakerTripped / resetConnectivityBreaker', () => {
  const CRED_FAILURE = 'Binance demo /api/v3/order failed (401): Unauthorized'
  const RATE_LIMIT_FAILURE = 'Binance demo /api/v3/order failed (429 code -1003): Too many requests.'

  it('starts untripped', async () => {
    const { isConnectivityBreakerTripped } = await import('./connectivity-breaker')
    expect(isConnectivityBreakerTripped()).toBe(false)
  })

  it('trips after the configured number of consecutive credential failures', async () => {
    const { recordConnectivityOutcome, isConnectivityBreakerTripped } = await import('./connectivity-breaker')
    recordConnectivityOutcome(CRED_FAILURE)
    expect(isConnectivityBreakerTripped()).toBe(false)
    recordConnectivityOutcome(CRED_FAILURE)
    expect(isConnectivityBreakerTripped()).toBe(false)
    recordConnectivityOutcome(CRED_FAILURE)
    expect(isConnectivityBreakerTripped()).toBe(true)
  })

  it('never increments on non-credential failures', async () => {
    const { recordConnectivityOutcome, isConnectivityBreakerTripped } = await import('./connectivity-breaker')
    recordConnectivityOutcome(RATE_LIMIT_FAILURE)
    recordConnectivityOutcome(RATE_LIMIT_FAILURE)
    recordConnectivityOutcome(RATE_LIMIT_FAILURE)
    recordConnectivityOutcome(RATE_LIMIT_FAILURE)
    expect(isConnectivityBreakerTripped()).toBe(false)
  })

  it('a success resets the counter but does not un-trip an already-tripped breaker', async () => {
    const { recordConnectivityOutcome, isConnectivityBreakerTripped } = await import('./connectivity-breaker')
    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(null) // success — resets the counter
    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(CRED_FAILURE)
    expect(isConnectivityBreakerTripped()).toBe(false) // only 2 consecutive since the reset

    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(CRED_FAILURE)
    expect(isConnectivityBreakerTripped()).toBe(true)

    recordConnectivityOutcome(null) // success does not clear an already-tripped breaker
    expect(isConnectivityBreakerTripped()).toBe(true)
  })

  it('resetConnectivityBreaker clears everything back to the default state', async () => {
    const { recordConnectivityOutcome, isConnectivityBreakerTripped, resetConnectivityBreaker } = await import('./connectivity-breaker')
    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(CRED_FAILURE)
    recordConnectivityOutcome(CRED_FAILURE)
    expect(isConnectivityBreakerTripped()).toBe(true)

    resetConnectivityBreaker()
    expect(isConnectivityBreakerTripped()).toBe(false)

    const { readFinanceStore } = await import('./finance-store')
    expect(readFinanceStore().connectivityBreaker).toEqual({
      consecutiveCredentialFailures: 0,
      firstFailureAt: null,
      tripped: false,
      trippedAt: null,
      trippedReason: null,
    })
  })

  it('resets the consecutive count when the failure window has expired', async () => {
    vi.useFakeTimers()
    try {
      const { recordConnectivityOutcome, isConnectivityBreakerTripped } = await import('./connectivity-breaker')
      recordConnectivityOutcome(CRED_FAILURE)
      recordConnectivityOutcome(CRED_FAILURE)
      vi.advanceTimersByTime(31 * 60_000) // past the 30-minute window
      recordConnectivityOutcome(CRED_FAILURE)
      recordConnectivityOutcome(CRED_FAILURE)
      // Only 2 consecutive since the window reset -- not 4.
      expect(isConnectivityBreakerTripped()).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
