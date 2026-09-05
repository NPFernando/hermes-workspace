import { describe, expect, it, vi } from 'vitest'
import * as os from 'node:os'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  BinanceDemoClient,
  BinanceLiveClient,
  DemoEnvironmentError,
  assertDemoBaseUrl,
  assertLiveBaseUrl,
  createDemoClientFromEnv,
  createLiveClientFromEnv,
  floorToStep,
} from './binance-demo-client'

describe('assertDemoBaseUrl', () => {
  it('accepts official demo hosts', () => {
    expect(assertDemoBaseUrl('https://demo-api.binance.com/api')).toBe(
      'demo-api.binance.com',
    )
    expect(assertDemoBaseUrl('https://testnet.binance.vision')).toBe(
      'testnet.binance.vision',
    )
  })

  it('refuses production hosts', () => {
    expect(() => assertDemoBaseUrl('https://api.binance.com')).toThrow(
      DemoEnvironmentError,
    )
    expect(() => assertDemoBaseUrl('https://data-api.binance.vision')).toThrow(
      DemoEnvironmentError,
    )
  })

  it('refuses unknown hosts', () => {
    expect(() => assertDemoBaseUrl('https://evil.example.com')).toThrow(
      DemoEnvironmentError,
    )
  })
})

describe('BinanceDemoClient construction guards', () => {
  const base = {
    apiKey: 'demo-key',
    apiSecret: 'demo-secret',
    baseUrl: 'https://demo-api.binance.com/api',
  }

  it('builds against a demo host', () => {
    expect(new BinanceDemoClient(base).host).toBe('demo-api.binance.com')
  })

  it('throws when pointed at production', () => {
    expect(
      () =>
        new BinanceDemoClient({ ...base, baseUrl: 'https://api.binance.com' }),
    ).toThrow(DemoEnvironmentError)
  })

  it('throws when demo key collides with the production key', () => {
    expect(
      () =>
        new BinanceDemoClient({
          ...base,
          apiKey: 'same',
          productionApiKey: 'same',
        }),
    ).toThrow(/equals the production key/)
  })

  it('requires credentials', () => {
    expect(() => new BinanceDemoClient({ ...base, apiKey: '' })).toThrow(
      DemoEnvironmentError,
    )
  })
})

describe('BinanceDemoClient requests hit the normalized demo base', () => {
  it('strips a trailing /api so paths do not double up', async () => {
    // signedRequest now records connectivity-breaker outcomes (reads/writes
    // the finance store) — isolate HOME + reset modules so this never
    // touches the real ~/.hermes, matching demo-trading-engine.test.ts's
    // pattern (finance-store.ts resolves its path from os.homedir() at
    // module load, so a plain top-of-file import is evaluated too early).
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'binance-demo-client-'))
    const realHome = process.env.HOME
    process.env.HOME = tmp
    vi.resetModules()
    try {
      const { BinanceDemoClient: FreshBinanceDemoClient } =
        await import('./binance-demo-client')
      const fetchImpl = vi.fn(async (url: string) => {
        // server time then account
        if (url.includes('/api/v3/account')) {
          return new Response(
            JSON.stringify({
              accountType: 'SPOT',
              canTrade: true,
              balances: [{ asset: 'USDT', free: '5000', locked: '0' }],
            }),
            { status: 200 },
          )
        }
        return new Response('{}', { status: 200 })
      }) as unknown as typeof fetch
      const client = new FreshBinanceDemoClient({
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
    } finally {
      if (realHome === undefined) delete process.env.HOME
      else process.env.HOME = realHome
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('BinanceDemoClient kline parsing', () => {
  it('preserves Binance aggressor buy volume for taker-imbalance signals', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            [
              1,
              '100',
              '110',
              '90',
              '105',
              '20',
              2,
              '2100',
              10,
              '12.5',
            ],
          ]),
          { status: 200 },
        ),
    ) as unknown as typeof fetch
    const client = new BinanceDemoClient({
      apiKey: 'k',
      apiSecret: 's',
      baseUrl: 'https://demo-api.binance.com',
      fetchImpl,
    })

    await expect(client.getKlines('BTCUSDT', '1h', 1)).resolves.toEqual([
      {
        openTime: 1,
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 20,
        takerBuyVolume: 12.5,
      },
    ])
  })
})

describe('floorToStep', () => {
  it('floors to an exact multiple of the step, decimal-safe', () => {
    // 0.07992 / 0.0001 = 799.199999... under naive FP — must still floor to 799 steps.
    expect(floorToStep(0.07992, 0.0001)).toBe(0.0799)
    expect(floorToStep(0.25, 0.001)).toBe(0.25)
    expect(floorToStep(5.643, 0.1)).toBe(5.6)
  })

  it('does not round up a value sitting just under a step boundary', () => {
    expect(floorToStep(0.0999999, 0.1)).toBe(0)
    expect(floorToStep(0.19999, 0.1)).toBe(0.1)
  })

  it('returns 0 for degenerate inputs', () => {
    expect(floorToStep(0, 0.001)).toBe(0)
    expect(floorToStep(-1, 0.001)).toBe(0)
    expect(floorToStep(1, 0)).toBe(0)
    expect(floorToStep(Number.NaN, 0.001)).toBe(0)
  })
})

describe('getSymbolFilters', () => {
  it('parses LOT_SIZE and NOTIONAL filters and caches per symbol', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            symbols: [
              {
                symbol: 'SOLUSDT',
                filters: [
                  {
                    filterType: 'LOT_SIZE',
                    minQty: '0.01000000',
                    maxQty: '9000',
                    stepSize: '0.01000000',
                  },
                  { filterType: 'NOTIONAL', minNotional: '5.00000000' },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch
    const client = new BinanceDemoClient({
      apiKey: 'k',
      apiSecret: 's',
      baseUrl: 'https://demo-api.binance.com',
      fetchImpl,
    })
    const filters = await client.getSymbolFilters('SOLUSDT')
    expect(filters).toEqual({ stepSize: 0.01, minQty: 0.01, minNotional: 5 })
    // Second call served from cache — no extra fetch.
    await client.getSymbolFilters('SOLUSDT')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const calledUrl = (fetchImpl as any).mock.calls[0][0] as string
    expect(calledUrl).toContain('/api/v3/exchangeInfo?symbol=SOLUSDT')
  })

  it('falls back to zeros when filters are missing and throws on HTTP failure', async () => {
    const okEmpty = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ symbols: [{ symbol: 'X', filters: [] }] }),
          { status: 200 },
        ),
    ) as unknown as typeof fetch
    const emptyClient = new BinanceDemoClient({
      apiKey: 'k',
      apiSecret: 's',
      baseUrl: 'https://demo-api.binance.com',
      fetchImpl: okEmpty,
    })
    expect(await emptyClient.getSymbolFilters('XUSDT')).toEqual({
      stepSize: 0,
      minQty: 0,
      minNotional: 0,
    })

    const failing = vi.fn(
      async () => new Response('{}', { status: 500 }),
    ) as unknown as typeof fetch
    const failingClient = new BinanceDemoClient({
      apiKey: 'k',
      apiSecret: 's',
      baseUrl: 'https://demo-api.binance.com',
      fetchImpl: failing,
    })
    await expect(failingClient.getSymbolFilters('SOLUSDT')).rejects.toThrow(
      'exchangeInfo',
    )
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
    expect(assertLiveBaseUrl('https://api.binance.com/api')).toBe(
      'api.binance.com',
    )
  })

  it('refuses demo, market-data, and unknown hosts', () => {
    expect(() => assertLiveBaseUrl('https://testnet.binance.vision')).toThrow(
      DemoEnvironmentError,
    )
    expect(() => assertLiveBaseUrl('https://data-api.binance.vision')).toThrow(
      DemoEnvironmentError,
    )
    expect(() => assertLiveBaseUrl('https://api1.binance.com')).toThrow(
      DemoEnvironmentError,
    )
  })
})

describe('BinanceLiveClient construction guards', () => {
  const base = {
    apiKey: 'live-key',
    apiSecret: 'live-secret',
    baseUrl: 'https://api.binance.com/api',
  }

  it('builds against the approved live host', () => {
    expect(new BinanceLiveClient(base).host).toBe('api.binance.com')
  })

  it('throws when pointed at testnet', () => {
    expect(
      () =>
        new BinanceLiveClient({
          ...base,
          baseUrl: 'https://testnet.binance.vision',
        }),
    ).toThrow(DemoEnvironmentError)
  })

  it('throws when live key collides with the testnet key', () => {
    expect(
      () =>
        new BinanceLiveClient({
          ...base,
          apiKey: 'same',
          testnetApiKey: 'same',
        }),
    ).toThrow(/testnet key/)
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
