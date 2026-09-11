import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchCsePrice, type CsePriceProvider } from './cse-market.service'

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
          hiTrade: 20.2,
          lowTrade: 19.4,
          tdyShareVolume: 1200,
          tdyTurnover: 24000,
        },
      }),
    }) as unknown as typeof fetch

    const result = await fetchCsePrice('JKH.N0000')
    expect(result).toMatchObject({
      price: 19.8,
      high: 20.2,
      low: 19.4,
      close: 19.8,
      volume: 1200,
      turnover: 24000,
    })
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

  it('retries one transient network failure, then returns the quote', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary network down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reqSymbolInfo: { lastTradedPrice: 21.4 } }),
      }) as unknown as typeof fetch

    await expect(fetchCsePrice('JKH.N0000')).resolves.toMatchObject({ price: 21.4 })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('retries one transient HTTP failure, then returns the quote', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ reqSymbolInfo: { lastTradedPrice: 22.1 } }),
      }) as unknown as typeof fetch

    await expect(fetchCsePrice('JKH.N0000')).resolves.toMatchObject({ price: 22.1 })
    expect(global.fetch).toHaveBeenCalledTimes(2)
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

  it('accepts an injected provider so the endpoint can be replaced safely', async () => {
    const provider: CsePriceProvider = {
      id: 'test-provider',
      fetchPrice: vi.fn().mockResolvedValue({
        price: 42,
        asOf: '2026-09-10T00:00:00.000Z',
      }),
    }
    await expect(fetchCsePrice('JKH.N0000', provider)).resolves.toEqual({
      price: 42,
      asOf: '2026-09-10T00:00:00.000Z',
    })
    expect(provider.fetchPrice).toHaveBeenCalledWith('JKH.N0000')
  })
})
