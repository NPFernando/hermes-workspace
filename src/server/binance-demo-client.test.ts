import { describe, expect, it, vi } from 'vitest'

import {
  BinanceDemoClient,
  BinanceLiveClient,
  DemoEnvironmentError,
  assertDemoBaseUrl,
  assertLiveBaseUrl,
  createDemoClientFromEnv,
  createLiveClientFromEnv,
} from './binance-demo-client'

describe('assertDemoBaseUrl', () => {
  it('accepts official demo hosts', () => {
    expect(assertDemoBaseUrl('https://demo-api.binance.com/api')).toBe('demo-api.binance.com')
    expect(assertDemoBaseUrl('https://testnet.binance.vision')).toBe('testnet.binance.vision')
  })

  it('refuses production hosts', () => {
    expect(() => assertDemoBaseUrl('https://api.binance.com')).toThrow(DemoEnvironmentError)
    expect(() => assertDemoBaseUrl('https://data-api.binance.vision')).toThrow(DemoEnvironmentError)
  })

  it('refuses unknown hosts', () => {
    expect(() => assertDemoBaseUrl('https://evil.example.com')).toThrow(DemoEnvironmentError)
  })
})

describe('BinanceDemoClient construction guards', () => {
  const base = { apiKey: 'demo-key', apiSecret: 'demo-secret', baseUrl: 'https://demo-api.binance.com/api' }

  it('builds against a demo host', () => {
    expect(new BinanceDemoClient(base).host).toBe('demo-api.binance.com')
  })

  it('throws when pointed at production', () => {
    expect(() => new BinanceDemoClient({ ...base, baseUrl: 'https://api.binance.com' })).toThrow(
      DemoEnvironmentError,
    )
  })

  it('throws when demo key collides with the production key', () => {
    expect(
      () => new BinanceDemoClient({ ...base, apiKey: 'same', productionApiKey: 'same' }),
    ).toThrow(/equals the production key/)
  })

  it('requires credentials', () => {
    expect(() => new BinanceDemoClient({ ...base, apiKey: '' })).toThrow(DemoEnvironmentError)
  })
})

describe('BinanceDemoClient requests hit the normalized demo base', () => {
  it('strips a trailing /api so paths do not double up', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      // server time then account
      if (url.includes('/api/v3/account')) {
        return new Response(
          JSON.stringify({ accountType: 'SPOT', canTrade: true, balances: [{ asset: 'USDT', free: '5000', locked: '0' }] }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 200 })
    }) as unknown as typeof fetch
    const client = new BinanceDemoClient({
      apiKey: 'k',
      apiSecret: 's',
      baseUrl: 'https://demo-api.binance.com/api',
      fetchImpl,
    })
    const acct = await client.getAccount()
    expect(acct.balances[0]).toEqual({ asset: 'USDT', free: 5000, locked: 0 })
    const calledUrl = (fetchImpl as any).mock.calls[0][0] as string
    expect(calledUrl).toContain('https://demo-api.binance.com/api/v3/account')
    expect(calledUrl).not.toContain('/api/api/')
    expect(calledUrl).toContain('signature=')
  })
})

describe('createDemoClientFromEnv', () => {
  it('returns null with a reason when creds are absent', () => {
    const { client, reason } = createDemoClientFromEnv({} as NodeJS.ProcessEnv)
    expect(client).toBeNull()
    expect(reason).toMatch(/not set/)
  })

  it('builds from BINANCE_TESTNET_* and ignores production vars', () => {
    const { client } = createDemoClientFromEnv({
      BINANCE_TESTNET_API_KEY: 'demo',
      BINANCE_TESTNET_API_SECRET: 'secret',
      BINANCE_TESTNET_BASE_URL: 'https://demo-api.binance.com/api',
      BINANCE_API_KEY: 'prod',
    } as unknown as NodeJS.ProcessEnv)
    expect(client?.host).toBe('demo-api.binance.com')
  })

  it('refuses when demo creds equal production creds', () => {
    const { client, reason } = createDemoClientFromEnv({
      BINANCE_TESTNET_API_KEY: 'same',
      BINANCE_TESTNET_API_SECRET: 'secret',
      BINANCE_API_KEY: 'same',
    } as unknown as NodeJS.ProcessEnv)
    expect(client).toBeNull()
    expect(reason).toMatch(/production key/)
  })
})


describe('assertLiveBaseUrl', () => {
  it('accepts only the approved production host', () => {
    expect(assertLiveBaseUrl('https://api.binance.com/api')).toBe('api.binance.com')
  })

  it('refuses demo, market-data, and unknown hosts', () => {
    expect(() => assertLiveBaseUrl('https://testnet.binance.vision')).toThrow(DemoEnvironmentError)
    expect(() => assertLiveBaseUrl('https://data-api.binance.vision')).toThrow(DemoEnvironmentError)
    expect(() => assertLiveBaseUrl('https://api1.binance.com')).toThrow(DemoEnvironmentError)
  })
})

describe('BinanceLiveClient construction guards', () => {
  const base = { apiKey: 'live-key', apiSecret: 'live-secret', baseUrl: 'https://api.binance.com/api' }

  it('builds against the approved live host', () => {
    expect(new BinanceLiveClient(base).host).toBe('api.binance.com')
  })

  it('throws when pointed at testnet', () => {
    expect(() => new BinanceLiveClient({ ...base, baseUrl: 'https://testnet.binance.vision' })).toThrow(
      DemoEnvironmentError,
    )
  })

  it('throws when live key collides with the testnet key', () => {
    expect(() => new BinanceLiveClient({ ...base, apiKey: 'same', testnetApiKey: 'same' })).toThrow(/testnet key/)
  })
})

describe('createLiveClientFromEnv', () => {
  it('requires an explicit live-trading env approval', () => {
    const { client, reason } = createLiveClientFromEnv({
      BINANCE_API_KEY: 'live',
      BINANCE_API_SECRET: 'secret',
    } as unknown as NodeJS.ProcessEnv)
    expect(client).toBeNull()
    expect(reason).toMatch(/approval/)
  })

  it('builds from production vars after approval', () => {
    const { client } = createLiveClientFromEnv({
      BINANCE_API_KEY: 'live',
      BINANCE_API_SECRET: 'secret',
      BINANCE_BASE_URL: 'https://api.binance.com/api',
      BINANCE_ALLOW_LIVE_TRADING: 'I_APPROVE_BINANCE_LIVE_TRADING',
      BINANCE_TESTNET_API_KEY: 'testnet',
    } as unknown as NodeJS.ProcessEnv)
    expect(client?.host).toBe('api.binance.com')
  })
})
