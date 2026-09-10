/**
 * Daily FX refresh source for PF-201 (configurable reporting currency).
 *
 * The ask was to use a Sri Lankan commercial-bank rate. In practice that
 * isn't fetchable: combank.lk returns 403 to every non-browser request, and
 * the Central Bank of Sri Lanka's machine-readable middle-rate feed was
 * discontinued in 2023 (its live page is JS-rendered). So this pulls the
 * daily mid-market rate from open.er-api.com (free, no key, one update per
 * day) and an optional `exchangeRateSpreadPct` finance setting nudges it
 * toward the rate the user actually gets from their bank.
 *
 * Never throws — every failure mode (network error, timeout, unexpected
 * shape, source down) returns null so the caller treats it as a normal
 * "try again tomorrow" outcome, exactly like cse-market.service.ts. This
 * must never be the only way a rate can get into the store: the manual
 * `update_exchange_rate` action stays.
 */
const ER_API_URL = 'https://open.er-api.com/v6/latest/LKR'
const REQUEST_TIMEOUT_MS = 8_000

export interface ExchangeRateFetchResult {
  /** currency code -> LKR per 1 unit of it, e.g. `{ USD: 328.4, AUD: 213.1 }`. */
  lkrPer: Record<string, number>
  /** ISO timestamp the source last refreshed its rates. */
  asOf: string
  source: string
}

/**
 * Fetch today's `<currency> -> LKR` rate for each of `targets` (LKR itself and
 * anything the source doesn't price are skipped). Returns null when nothing
 * usable could be fetched.
 */
export async function fetchLkrExchangeRates(
  targets: ReadonlyArray<string>,
): Promise<ExchangeRateFetchResult | null> {
  const wanted = [
    ...new Set(targets.map((t) => t.trim().toUpperCase())),
  ].filter((t) => /^[A-Z]{3}$/.test(t) && t !== 'LKR')
  if (wanted.length === 0) return null

  try {
    const res = await fetch(ER_API_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) return null

    const data = (await res.json()) as {
      result?: string
      rates?: Record<string, unknown>
      time_last_update_utc?: string
    }
    if (data.result !== 'success' || !data.rates) return null

    const lkrPer: Record<string, number> = {}
    for (const cur of wanted) {
      // `rates[cur]` is units of `cur` per 1 LKR (base=LKR); invert to LKR per unit.
      const perLkr = data.rates[cur]
      if (typeof perLkr === 'number' && Number.isFinite(perLkr) && perLkr > 0) {
        lkrPer[cur] = 1 / perLkr
      }
    }
    if (Object.keys(lkrPer).length === 0) return null

    const asOf = data.time_last_update_utc
      ? new Date(data.time_last_update_utc).toISOString()
      : new Date().toISOString()
    return { lkrPer, asOf, source: 'open.er-api.com' }
  } catch {
    return null
  }
}
