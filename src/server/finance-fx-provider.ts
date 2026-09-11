export type FxProviderQuote = {
  base: string
  target: string
  rate: number
  date: string
  source: 'frankfurter:v2'
  observedAt: string
}

export type FxProviderHealth = {
  status: 'healthy' | 'stale' | 'unknown'
  source?: string
  latestRateDate?: string
  lastObservedAt?: string
  detail: string
}

/** OPS-104: read-only freshness assessment for the last stored provider quote. */
export function assessFxProviderHealth(
  rates: Array<Record<string, unknown>>,
  now = Date.now(),
  staleAfterMs = 7 * 24 * 60 * 60 * 1000,
): FxProviderHealth {
  const providerRates = rates
    .filter(
      (rate) =>
        rate.source === 'frankfurter:v2' &&
        typeof rate.observedAt === 'string' &&
        typeof rate.date === 'string',
    )
    .sort((a, b) =>
      String(b.observedAt).localeCompare(String(a.observedAt)),
    )
  if (providerRates.length === 0) {
    return {
      status: 'unknown',
      detail: 'No stored provider quote is available. Refresh a rate to establish provider health.',
    }
  }
  const latest = providerRates[0]
  const observedAt = Date.parse(String(latest.observedAt))
  if (!Number.isFinite(observedAt)) {
    return {
      status: 'stale',
      source: 'frankfurter:v2',
      latestRateDate: String(latest.date),
      lastObservedAt: String(latest.observedAt),
      detail: 'The latest provider observation has an invalid timestamp and should be refreshed.',
    }
  }
  const stale = now - observedAt > staleAfterMs
  return {
    status: stale ? 'stale' : 'healthy',
    source: 'frankfurter:v2',
    latestRateDate: String(latest.date),
    lastObservedAt: String(latest.observedAt),
    detail: stale
      ? 'The latest provider quote is older than seven days; refresh before relying on it for current valuations.'
      : 'A recent provider quote is available. Stored rates remain historical and are not refreshed automatically.',
  }
}

type FrankfurterResponse = {
  date?: unknown
  base?: unknown
  quote?: unknown
  rate?: unknown
}

/**
 * PF-203: explicit, user-triggered reference-rate lookup. This provider is
 * deliberately isolated from persistence; callers decide whether to save it.
 */
export async function fetchFrankfurterRate(
  base: string,
  target: string,
  fetcher: typeof fetch = fetch,
): Promise<FxProviderQuote> {
  const normalizedBase = base.trim().toUpperCase()
  const normalizedTarget = target.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(normalizedBase) || !/^[A-Z]{3}$/.test(normalizedTarget)) {
    throw new Error('Currency codes must be three letters')
  }
  if (normalizedBase === normalizedTarget) throw new Error('Currencies must differ')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetcher(
      `https://api.frankfurter.dev/v2/rate/${normalizedBase}/${normalizedTarget}`,
      { headers: { accept: 'application/json' }, signal: controller.signal },
    )
    if (!response.ok) throw new Error(`FX provider returned HTTP ${response.status}`)
    const body = (await response.json()) as FrankfurterResponse
    const rate = typeof body.rate === 'number' ? body.rate : Number(body.rate)
    const date = typeof body.date === 'string' ? body.date : ''
    if (!Number.isFinite(rate) || rate <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error('FX provider returned an invalid rate')
    }
    return {
      base: normalizedBase,
      target: normalizedTarget,
      rate,
      date,
      source: 'frankfurter:v2',
      observedAt: new Date().toISOString(),
    }
  } finally {
    clearTimeout(timeout)
  }
}
