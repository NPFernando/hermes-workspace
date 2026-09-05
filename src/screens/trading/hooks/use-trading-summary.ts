import { useEffect, useState } from 'react'

export type TradingEngineArmState = 'live' | 'paper' | 'gated' | 'disabled'

export type TradingEngineStatus = {
  id: string
  label: string
  armState: TradingEngineArmState
  reason: string
}

export type TradingSummary = {
  tradingMode: string
  emergencyKillSwitch: boolean
  todayPnlQuote: number
  totalPnlQuote: number
  openPositions: number
  winRate: number | null
  engines: Array<TradingEngineStatus>
}

export type AccountBaseline = {
  equityQuote: number
  recordedAt: string
}

export type AccountOverview = {
  label: string
  tradingMode: string
  clientAvailable: boolean
  balanceFetchOk: boolean
  baseline: AccountBaseline | null
  availableQuote: number
  deployedQuote: number
  unrealizedPnlQuote: number
  realizedPnlQuote: number
  todayPnlQuote: number
  equityQuote: number
  netVsBaselineQuote: number | null
  archivedPositionsCount: number
  archivedTradesCount: number
  asOfMs: number
}

interface TradingSummaryResponse {
  summary: TradingSummary | null
  account: AccountOverview | null
  error: string | null
  /** Re-fetches immediately (e.g. right after recording a new baseline)
   * without waiting for the next scheduled poll. */
  refresh: () => Promise<void>
}

const POLL_INTERVAL_MS = 30_000

// Module-level so every component calling useTradingSummary() in the same
// browser tab shares one fetch + one 30s timer instead of each mounting its
// own — this is what AccountOverviewCard and TradingSummaryStrip previously
// did independently, doubling load on /api/trading/summary for no reason
// (both just needed different slices of the same response).
let cachedSummary: TradingSummary | null = null
let cachedAccount: AccountOverview | null = null
let cachedError: string | null = null
let inFlight: Promise<void> | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
const subscribers = new Set<() => void>()

function notifySubscribers(): void {
  for (const sub of subscribers) sub()
}

async function fetchSummary(): Promise<void> {
  if (inFlight) {
    await inFlight
    return
  }
  inFlight = (async () => {
    try {
      const res = await fetch('/api/trading/summary', { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as {
        ok: boolean
        summary?: TradingSummary
        account?: AccountOverview
        error?: string
      }
      if (!data.ok) throw new Error(data.error || 'Trading summary unavailable')
      cachedSummary = data.summary ?? null
      cachedAccount = data.account ?? null
      cachedError = null
    } catch (nextError) {
      cachedError =
        nextError instanceof Error
          ? nextError.message
          : 'Trading summary unavailable'
    } finally {
      inFlight = null
      notifySubscribers()
    }
  })()
  await inFlight
}

function ensurePolling(): void {
  if (pollTimer) return
  pollTimer = setInterval(() => void fetchSummary(), POLL_INTERVAL_MS)
}

/**
 * Shared /api/trading/summary fetch + poll used by both TradingSummaryStrip
 * and AccountOverviewCard (and any future consumer) so they never issue
 * duplicate requests for the same data — see the module-level cache above.
 * The first mounted subscriber (per browser tab) triggers the initial fetch
 * and starts the shared 30s timer; the timer is torn down once the last
 * subscriber unmounts.
 */
export function useTradingSummary(): TradingSummaryResponse {
  const [, setTick] = useState(0)

  useEffect(() => {
    const rerender = () => setTick((t) => t + 1)
    subscribers.add(rerender)
    ensurePolling()
    if (!cachedSummary && !cachedAccount && !cachedError) {
      void fetchSummary()
    }
    return () => {
      subscribers.delete(rerender)
      if (subscribers.size === 0 && pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }
  }, [])

  return {
    summary: cachedSummary,
    account: cachedAccount,
    error: cachedError,
    refresh: fetchSummary,
  }
}
