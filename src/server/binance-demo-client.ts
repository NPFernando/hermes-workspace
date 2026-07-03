/**
 * Signed Binance SPOT client — HARD-LOCKED to the demo/testnet environment.
 *
 * Safety contract (defense in depth so a real order can never leave this file):
 *  1. The base URL is validated against an allowlist of official demo hosts.
 *     Anything else (api.binance.com et al.) throws at construction.
 *  2. Credentials are read ONLY from BINANCE_TESTNET_* — the production
 *     BINANCE_API_KEY/SECRET are never touched here.
 *  3. If the demo key/secret happen to equal the production ones, construction
 *     throws (guards against a copy-paste that would sign real requests).
 *  4. Order endpoints re-assert the demo host immediately before sending.
 *
 * Ref: https://developers.binance.com/legacy-docs/binance-spot-api-docs/demo-mode/general-info
 */
import crypto from 'node:crypto'

// Official Binance demo/testnet spot hosts. Production hosts must never appear.
const ALLOWED_DEMO_HOSTS = new Set([
  'demo-api.binance.com',
  'testnet.binance.vision',
])

const PRODUCTION_HOSTS = new Set([
  'api.binance.com',
  'api1.binance.com',
  'api2.binance.com',
  'api3.binance.com',
  'api4.binance.com',
  'data-api.binance.vision',
])

export type OrderSide = 'BUY' | 'SELL'
export type OrderType = 'MARKET' | 'LIMIT'

export interface DemoBalance {
  asset: string
  free: number
  locked: number
}

export interface DemoAccount {
  accountType: string
  canTrade: boolean
  balances: Array<DemoBalance>
  uid?: number
}

export interface DemoOrderResult {
  symbol: string
  orderId: number
  status: string
  side: OrderSide
  type: OrderType
  executedQty: number
  cummulativeQuoteQty: number
  fills: Array<{ price: number; qty: number; commission: number; commissionAsset: string }>
  transactTime: number
  avgPrice: number
}

export class DemoEnvironmentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DemoEnvironmentError'
  }
}

/** Extract and validate the host of a base URL, or throw. */
export function assertDemoBaseUrl(baseUrl: string): string {
  let host: string
  try {
    host = new URL(baseUrl).host.toLowerCase()
  } catch {
    throw new DemoEnvironmentError(`Invalid Binance base URL: ${baseUrl}`)
  }
  if (PRODUCTION_HOSTS.has(host)) {
    throw new DemoEnvironmentError(
      `Refusing to build a demo trading client against production host "${host}". ` +
        `Execution is restricted to the Binance demo environment.`,
    )
  }
  if (!ALLOWED_DEMO_HOSTS.has(host)) {
    throw new DemoEnvironmentError(
      `Host "${host}" is not a recognized Binance demo host ` +
        `(${[...ALLOWED_DEMO_HOSTS].join(', ')}).`,
    )
  }
  return host
}

export interface DemoClientConfig {
  apiKey: string
  apiSecret: string
  baseUrl: string
  /** Production creds, passed only so we can refuse if they collide. */
  productionApiKey?: string
  recvWindow?: number
  fetchImpl?: typeof fetch
}

export class BinanceDemoClient {
  private readonly apiKey: string
  private readonly apiSecret: string
  private readonly base: string
  private readonly recvWindow: number
  private readonly fetchImpl: typeof fetch
  readonly host: string

  constructor(config: DemoClientConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new DemoEnvironmentError('Demo API key and secret are required.')
    }
    if (
      config.productionApiKey &&
      config.apiKey.trim() === config.productionApiKey.trim()
    ) {
      throw new DemoEnvironmentError(
        'Demo API key equals the production key — refusing to sign requests. ' +
          'Set BINANCE_TESTNET_API_KEY to your demo credentials.',
      )
    }
    this.host = assertDemoBaseUrl(config.baseUrl)
    // Normalize to the scheme+host root: request paths already include the
    // "/api/v3/..." prefix, so a base ending in "/api" (as in .env) would
    // otherwise double up to "/api/api/v3/...".
    this.base = config.baseUrl.replace(/\/+$/, '').replace(/\/api$/, '')
    this.apiKey = config.apiKey.trim()
    this.apiSecret = config.apiSecret.trim()
    this.recvWindow = config.recvWindow ?? 10_000
    this.fetchImpl = config.fetchImpl ?? fetch
  }

  private sign(query: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(query).digest('hex')
  }

  private async signedRequest(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<any> {
    // Re-assert the demo host right before any signed call leaves the process.
    assertDemoBaseUrl(this.base)
    const timestamp = Date.now()
    const search = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      timestamp: String(timestamp),
      recvWindow: String(this.recvWindow),
    })
    const signature = this.sign(search.toString())
    search.append('signature', signature)
    const url = `${this.base}${path}?${search.toString()}`
    const res = await this.fetchImpl(url, {
      method,
      headers: { 'X-MBX-APIKEY': this.apiKey },
      signal: AbortSignal.timeout(15_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const code = (body as any)?.code
      const msg = (body as any)?.msg || res.statusText
      throw new DemoEnvironmentError(`Binance demo ${path} failed (${res.status}${code ? ` code ${code}` : ''}): ${msg}`)
    }
    return body
  }

  async ping(): Promise<boolean> {
    assertDemoBaseUrl(this.base)
    const res = await this.fetchImpl(`${this.base}/api/v3/ping`, {
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  }

  /** Unsigned: latest price for a symbol on the demo environment. */
  async getPrice(symbol: string): Promise<number> {
    assertDemoBaseUrl(this.base)
    const res = await this.fetchImpl(`${this.base}/api/v3/ticker/price?symbol=${symbol}`, {
      signal: AbortSignal.timeout(10_000),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new DemoEnvironmentError(`price ${symbol} failed (${res.status})`)
    return parseFloat((body as any).price)
  }

  /** Unsigned: recent candles for strategy evaluation. */
  async getKlines(symbol: string, interval = '1h', limit = 100): Promise<Array<{
    openTime: number; open: number; high: number; low: number; close: number; volume: number
  }>> {
    assertDemoBaseUrl(this.base)
    const url = `${this.base}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(12_000) })
    const rows = await res.json().catch(() => [])
    if (!res.ok || !Array.isArray(rows)) throw new DemoEnvironmentError(`klines ${symbol} failed (${res.status})`)
    return rows.map((r: any) => ({
      openTime: r[0],
      open: parseFloat(r[1]),
      high: parseFloat(r[2]),
      low: parseFloat(r[3]),
      close: parseFloat(r[4]),
      volume: parseFloat(r[5]),
    }))
  }

  async getAccount(): Promise<DemoAccount> {
    const raw = await this.signedRequest('GET', '/api/v3/account')
    return {
      accountType: raw.accountType,
      canTrade: raw.canTrade,
      uid: raw.uid,
      balances: (raw.balances || [])
        .map((b: any) => ({
          asset: b.asset,
          free: parseFloat(b.free),
          locked: parseFloat(b.locked),
        }))
        .filter((b: DemoBalance) => b.free > 0 || b.locked > 0),
    }
  }

  /** Place a spot order on the demo environment. */
  async placeOrder(input: {
    symbol: string
    side: OrderSide
    type: OrderType
    quantity?: number
    quoteOrderQty?: number
    price?: number
  }): Promise<DemoOrderResult> {
    const params: Record<string, string | number> = {
      symbol: input.symbol,
      side: input.side,
      type: input.type,
    }
    if (input.type === 'LIMIT') {
      if (input.price == null || input.quantity == null) {
        throw new DemoEnvironmentError('LIMIT order requires price and quantity.')
      }
      params.timeInForce = 'GTC'
      params.price = input.price
      params.quantity = input.quantity
    } else {
      // MARKET: either base quantity or quote spend.
      if (input.quoteOrderQty != null) params.quoteOrderQty = input.quoteOrderQty
      else if (input.quantity != null) params.quantity = input.quantity
      else throw new DemoEnvironmentError('MARKET order requires quantity or quoteOrderQty.')
    }
    const raw = await this.signedRequest('POST', '/api/v3/order', params)
    const fills = (raw.fills || []).map((f: any) => ({
      price: parseFloat(f.price),
      qty: parseFloat(f.qty),
      commission: parseFloat(f.commission),
      commissionAsset: f.commissionAsset,
    }))
    const executedQty = parseFloat(raw.executedQty || '0')
    const cummulativeQuoteQty = parseFloat(raw.cummulativeQuoteQty || '0')
    return {
      symbol: raw.symbol,
      orderId: raw.orderId,
      status: raw.status,
      side: raw.side,
      type: raw.type,
      executedQty,
      cummulativeQuoteQty,
      fills,
      transactTime: raw.transactTime,
      avgPrice: executedQty > 0 ? cummulativeQuoteQty / executedQty : 0,
    }
  }

  async cancelOrder(symbol: string, orderId: number): Promise<void> {
    await this.signedRequest('DELETE', '/api/v3/order', { symbol, orderId })
  }
}

/**
 * Build a demo client from environment variables, or return null (with a
 * reason) when demo credentials are absent/misconfigured. Never throws for
 * missing config — callers degrade gracefully.
 */
export function createDemoClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): { client: BinanceDemoClient | null; reason?: string } {
  const apiKey = env.BINANCE_TESTNET_API_KEY?.trim()
  const apiSecret = env.BINANCE_TESTNET_API_SECRET?.trim()
  const baseUrl = env.BINANCE_TESTNET_BASE_URL?.trim() || 'https://demo-api.binance.com'
  if (!apiKey || !apiSecret) {
    return { client: null, reason: 'BINANCE_TESTNET_API_KEY / BINANCE_TESTNET_API_SECRET not set' }
  }
  try {
    const client = new BinanceDemoClient({
      apiKey,
      apiSecret,
      baseUrl,
      productionApiKey: env.BINANCE_API_KEY,
    })
    return { client }
  } catch (err) {
    return { client: null, reason: err instanceof Error ? err.message : String(err) }
  }
}
