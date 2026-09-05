import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCsePrice } from './cse-market.service'

const originalFetch = global.fetch

afterEach(() => {
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('fetchCsePrice', () => {
  it('returns the price on a successful response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reqSymbolInfo: {
          symbol: 'JKH.N0000',
          lastTradedPrice: 19.8,
          closingPrice: 19.8,
        },
      }),
    }) as unknown as typeof fetch

    const result = await fetchCsePrice('JKH.N0000')
    expect(result).toMatchObject({ price: 19.8 })
    expect(result?.asOf).toBeTruthy()
  })

  it('falls back to closingPrice when lastTradedPrice is missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        reqSymbolInfo: { symbol: 'JKH.N0000', closingPrice: 20.1 },
      }),
    }) as unknown as typeof fetch

    const result = await fetchCsePrice('JKH.N0000')
    expect(result).toMatchObject({ price: 20.1 })
  })

  it('returns null on a non-ok response (unknown symbol)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({}),
    }) as unknown as typeof fetch
    expect(await fetchCsePrice('NOTREAL.X0000')).toBeNull()
  })

  it('returns null when the response has no usable price field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    }) as unknown as typeof fetch
    expect(await fetchCsePrice('JKH.N0000')).toBeNull()
  })

  it('returns null on a network error, never throws', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error('network down')) as unknown as typeof fetch
    expect(await fetchCsePrice('JKH.N0000')).toBeNull()
  })

  it('returns null for an empty symbol without making a request', async () => {
    const fetchSpy = vi.fn()
    global.fetch = fetchSpy as unknown as typeof fetch
    expect(await fetchCsePrice('   ')).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null for a non-positive price (defensive against a malformed unofficial response)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reqSymbolInfo: { lastTradedPrice: 0 } }),
    }) as unknown as typeof fetch
    expect(await fetchCsePrice('JKH.N0000')).toBeNull()
  })
})
