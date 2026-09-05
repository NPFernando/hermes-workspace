/**
 * Colombo Stock Exchange (CSE, Sri Lanka) current-price lookup for stock
 * holdings — no official CSE API exists. This calls the same unofficial
 * endpoint cse.lk's own website JS uses (POST, form-encoded `symbol` param)
 * — confirmed live against real symbols (e.g. JKH.N0000) during
 * development; no published Terms of Use was found either way (checked:
 * no ToS/disclaimer page exists on cse.lk), robots.txt does not disallow
 * /api/, and it's a plain public-quote read (no auth, no write).
 *
 * Undocumented and could change or start rate-limiting/blocking without
 * notice — this must NEVER be the only way to get a price into the app.
 * Every caller treats a failure here as a normal, expected outcome (not an
 * error) and falls back to the user manually entering a price — see
 * StockHolding.priceSource ('cse_api' | 'manual') and the
 * refresh_stock_price action in routes/api/finance.ts.
 */
const CSE_API_URL = 'https://www.cse.lk/api/companyInfoSummery'
const REQUEST_TIMEOUT_MS = 8_000

interface CseCompanyInfoSummeryResponse {
  reqSymbolInfo?: {
    symbol?: string
    lastTradedPrice?: number
    closingPrice?: number
  }
}

export interface CsePriceResult {
  price: number
  asOf: string
}

/**
 * Never throws — every failure mode (network error, timeout, unknown
 * symbol, unexpected response shape) returns null so the caller can fall
 * back to manual price entry rather than surfacing this as an app error.
 */
export async function fetchCsePrice(
  symbol: string,
): Promise<CsePriceResult | null> {
  const trimmed = symbol.trim()
  if (!trimmed) return null

  try {
    const res = await fetch(CSE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `symbol=${encodeURIComponent(trimmed)}`,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) return null

    const data = (await res.json()) as CseCompanyInfoSummeryResponse
    const price =
      data.reqSymbolInfo?.lastTradedPrice ?? data.reqSymbolInfo?.closingPrice
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0)
      return null

    return { price, asOf: new Date().toISOString() }
  } catch {
    return null
  }
}
