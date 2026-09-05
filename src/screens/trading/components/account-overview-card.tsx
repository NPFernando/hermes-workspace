import { useEffect, useState } from 'react'
import { StatCard } from '../../finance/components/stat-card'
import { formatUsdt } from '../format-helpers'
import { useTradingSummary } from '../hooks/use-trading-summary'

function pnlTone(value: number): 'good' | 'warn' | 'neutral' {
  if (value > 0) return 'good'
  if (value < 0) return 'warn'
  return 'neutral'
}

function formatAsOf(asOfMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - asOfMs) / 1000))
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  return `${minutes}m ago`
}

/**
 * "What do we actually have" — a single, plain-language card showing
 * starting balance, available/deployed capital, realized (earned/lost) and
 * unrealized P/L, and current equity, so it's obvious at a glance without
 * cross-referencing the individual engine panels below. Always the Binance
 * sandbox/testnet account today (resettable, paper-trade validation), which
 * is called out explicitly in the header so it's never mistaken for real
 * money.
 */
export function AccountOverviewCard() {
  const { account, error, refresh } = useTradingSummary()
  const [recording, setRecording] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [, setTick] = useState(0)

  useEffect(() => {
    // Re-render every few seconds so the "as of Xs ago" label ticks up even
    // between the 30s data refreshes driven by the shared hook.
    const tickInterval = setInterval(() => setTick((t) => t + 1), 5_000)
    return () => clearInterval(tickInterval)
  }, [])

  async function recordBaseline() {
    if (!account) return
    setRecording(true)
    setRecordError(null)
    try {
      const res = await fetch('/api/finance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'record_account_baseline',
          equityQuote: account.equityQuote,
        }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || data.ok === false)
        throw new Error(data.error || `HTTP ${res.status}`)
      await refresh()
    } catch (nextError) {
      setRecordError(
        nextError instanceof Error ? nextError.message : 'Request failed',
      )
    } finally {
      setRecording(false)
    }
  }

  if (error) {
    return (
      <section className="mt-6 rounded-3xl border border-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] p-4 text-sm text-[var(--theme-danger)]">
        Account overview unavailable: {error}
      </section>
    )
  }
  if (!account) {
    return (
      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-4 text-sm text-[var(--theme-muted)]">
        Loading account overview…
      </section>
    )
  }

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Trading Account Overview</h2>
          <p className="mt-1 text-sm text-[var(--theme-muted)]">
            {account.label} — this account can be reset at any time; nothing
            here is real money. It's used to validate the engine and tune its
            buy/sell instinct before any live trading is ever considered.
          </p>
          <p className="mt-1 text-xs text-[var(--theme-muted)]">
            Balance/price data as of {formatAsOf(account.asOfMs)} (refreshes
            in the background every ~20s).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void recordBaseline()}
          disabled={recording}
          className="rounded-xl border border-[var(--theme-border)] bg-[var(--theme-panel)] px-3 py-2 text-xs font-medium text-[var(--theme-text)] hover:bg-[color-mix(in_srgb,var(--theme-text)_6%,transparent)] disabled:opacity-50"
        >
          {recording ? 'Recording…' : 'Record current equity as new baseline'}
        </button>
      </div>
      {recordError && (
        <p className="mt-2 text-xs text-[var(--theme-danger)]">
          {recordError}
        </p>
      )}
      {!account.clientAvailable && (
        <p className="mt-2 text-xs text-[var(--theme-warning)]">
          Exchange balance is currently unavailable — figures below may be
          incomplete until the connection recovers.
        </p>
      )}
      {account.clientAvailable && !account.balanceFetchOk && (
        <p className="mt-2 text-xs text-[var(--theme-warning)]">
          Couldn't read the exchange's free balance just now (network hiccup
          or rate limit) — "Available"/"Current equity" below may read low
          until the next refresh; this isn't necessarily your real balance.
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Starting baseline"
          value={
            account.baseline
              ? formatUsdt(account.baseline.equityQuote)
              : 'Not set yet'
          }
        />
        <StatCard label="Available" value={formatUsdt(account.availableQuote)} />
        <StatCard label="Deployed" value={formatUsdt(account.deployedQuote)} />
        <StatCard
          label="Current equity"
          value={formatUsdt(account.equityQuote)}
        />
        <StatCard
          label="Realized P&L (all-time)"
          value={formatUsdt(account.realizedPnlQuote)}
          tone={pnlTone(account.realizedPnlQuote)}
        />
        <StatCard
          label="Unrealized P&L (open)"
          value={formatUsdt(account.unrealizedPnlQuote)}
          tone={pnlTone(account.unrealizedPnlQuote)}
        />
        <StatCard
          label="Today's P&L"
          value={formatUsdt(account.todayPnlQuote)}
          tone={pnlTone(account.todayPnlQuote)}
        />
        <StatCard
          label="Net vs. baseline"
          value={
            account.netVsBaselineQuote === null
              ? '—'
              : formatUsdt(account.netVsBaselineQuote)
          }
          tone={
            account.netVsBaselineQuote === null
              ? 'neutral'
              : pnlTone(account.netVsBaselineQuote)
          }
        />
      </div>
      {(account.archivedPositionsCount > 0 ||
        account.archivedTradesCount > 0) && (
        <p className="mt-3 text-xs text-[var(--theme-muted)]">
          {account.archivedPositionsCount} older position(s) and{' '}
          {account.archivedTradesCount} older trade(s) from a previous mode
          are excluded from these totals — see "Archived history" below.
        </p>
      )}
    </section>
  )
}
