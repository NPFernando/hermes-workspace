import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLkrExchangeRates } from './exchange-rate.service'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

const okResponse = (rates: Record<string, number>) =>
  ({
    ok: true,
    json: async () => ({
      result: 'success',
      time_last_update_utc: 'Thu, 10 Sep 2026 00:02:31 +0000',
      rates,
    }),
  }) as unknown as Response

describe('fetchLkrExchangeRates', () => {
  it('inverts the source rate to LKR-per-unit for each requested currency', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        okResponse({ LKR: 1, USD: 0.003046, AUD: 0.004223 }),
      ) as unknown as typeof fetch

    const result = await fetchLkrExchangeRates(['USD', 'AUD', 'LKR'])
    expect(result?.source).toBe('open.er-api.com')
    expect(result?.asOf).toBe('2026-09-10T00:02:31.000Z')
    expect(result?.lkrPer.USD).toBeCloseTo(1 / 0.003046)
    expect(result?.lkrPer.AUD).toBeCloseTo(1 / 0.004223)
    // LKR itself is never a key.
    expect(result?.lkrPer.LKR).toBeUndefined()
  })

  it('skips a currency the source does not price, keeps the rest', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(okResponse({ USD: 0.003046 })) as unknown as typeof fetch

    const result = await fetchLkrExchangeRates(['USD', 'AUD'])
    expect(Object.keys(result?.lkrPer ?? {})).toEqual(['USD'])
  })

  it('returns null when no requested currency could be priced', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(okResponse({ USD: 0.003 })) as unknown as typeof fetch
    expect(await fetchLkrExchangeRates(['AUD'])).toBeNull()
  })

  it('returns null on result != success', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: 'error', 'error-type': 'unsupported-code' }),
    }) as unknown as typeof fetch
    expect(await fetchLkrExchangeRates(['USD'])).toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({}) }) as unknown as typeof fetch
    expect(await fetchLkrExchangeRates(['USD'])).toBeNull()
  })

  it('returns null (never throws) on a network error', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error('ECONNRESET')) as unknown as typeof fetch
    expect(await fetchLkrExchangeRates(['USD'])).toBeNull()
  })

  it('returns null without fetching when no non-LKR target is given', async () => {
    const spy = vi.fn()
    global.fetch = spy as unknown as typeof fetch
    expect(await fetchLkrExchangeRates(['LKR', 'lkr'])).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})
