import { describe, expect, it } from 'vitest'
import {
  fetchAddressBalance,
  whaleFlowDecision,
} from './onchain-whale-tracking'

describe('fetchAddressBalance', () => {
  it('builds the correct URL and converts wei to native units', async () => {
    let capturedUrl = ''
    const fakeFetchJson = async <T>(url: string): Promise<T> => {
      capturedUrl = url
      return {
        status: '1',
        message: 'OK',
        result: '2500000000000000000',
      } as unknown as T
    }
    const balance = await fetchAddressBalance(
      'ethereum',
      '0xabc',
      'test-key',
      fakeFetchJson,
    )
    expect(capturedUrl).toBe(
      'https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance&address=0xabc&tag=latest&apikey=test-key',
    )
    expect(balance).toBeCloseTo(2.5, 10)
  })

  it('uses chainid 56 for bsc', async () => {
    let capturedUrl = ''
    const fakeFetchJson = async <T>(url: string): Promise<T> => {
      capturedUrl = url
      return {
        status: '1',
        message: 'OK',
        result: '1000000000000000000',
      } as unknown as T
    }
    await fetchAddressBalance('bsc', '0xdef', 'test-key', fakeFetchJson)
    expect(capturedUrl).toContain('chainid=56')
  })

  it('throws when Etherscan reports a non-1 status', async () => {
    const fakeFetchJson = async <T>(): Promise<T> =>
      ({
        status: '0',
        message: 'Invalid API Key',
        result: 'Invalid API Key',
      }) as unknown as T
    await expect(
      fetchAddressBalance('ethereum', '0xabc', 'bad-key', fakeFetchJson),
    ).rejects.toThrow('Invalid API Key')
  })

  it('throws on a non-numeric result', async () => {
    const fakeFetchJson = async <T>(): Promise<T> =>
      ({ status: '1', message: 'OK', result: 'not-a-number' }) as unknown as T
    await expect(
      fetchAddressBalance('ethereum', '0xabc', 'test-key', fakeFetchJson),
    ).rejects.toThrow('non-numeric balance')
  })

  it('propagates a fetch failure rather than swallowing it (callers are responsible for try/catch)', async () => {
    const failingFetchJson = async <T>(): Promise<T> => {
      throw new Error('network error')
    }
    await expect(
      fetchAddressBalance('ethereum', '0xabc', 'test-key', failingFetchJson),
    ).rejects.toThrow('network error')
  })
})

describe('whaleFlowDecision', () => {
  it('holds when there is no prior balance', () => {
    const d = whaleFlowDecision(null, 100, 'exchange', 'Binance Hot Wallet')
    expect(d.signal).toBe('HOLD')
    expect(d.confidence).toBe(0)
  })

  it('holds when the change is below the confidence floor', () => {
    const d = whaleFlowDecision(1000, 1000.5, 'exchange', 'Binance Hot Wallet')
    expect(d.signal).toBe('HOLD')
  })

  it('leans SELL on an exchange inflow (supply building up to be sold)', () => {
    const d = whaleFlowDecision(1000, 1200, 'exchange', 'Binance Hot Wallet')
    expect(d.signal).toBe('SELL')
    expect(d.reason).toContain('inflow')
    expect(d.confidence).toBeGreaterThan(0)
  })

  it('leans BUY on an exchange outflow (withdrawal, reduced sell-side supply)', () => {
    const d = whaleFlowDecision(1000, 800, 'exchange', 'Binance Hot Wallet')
    expect(d.signal).toBe('BUY')
    expect(d.reason).toContain('outflow')
  })

  it('leans BUY on whale accumulation (inflow to a private holder)', () => {
    const d = whaleFlowDecision(1000, 1200, 'whale', 'Known Whale #1')
    expect(d.signal).toBe('BUY')
    expect(d.reason).toContain('inflow')
  })

  it('leans SELL on whale distribution (outflow from a private holder)', () => {
    const d = whaleFlowDecision(1000, 800, 'whale', 'Known Whale #1')
    expect(d.signal).toBe('SELL')
    expect(d.reason).toContain('outflow')
  })

  it('caps confidence at 1 for an extreme change', () => {
    const d = whaleFlowDecision(100, 1000, 'whale', 'Known Whale #1')
    expect(d.confidence).toBe(1)
  })
})
