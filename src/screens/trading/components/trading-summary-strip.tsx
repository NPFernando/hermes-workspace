import { useEffect, useState } from 'react'
import { StatCard } from '../../finance/components/stat-card'
import { formatUsdt } from '../format-helpers'

type TradingEngineArmState = 'live' | 'paper' | 'gated' | 'disabled'

type TradingEngineStatus = {
  id: string
  label: string
  armState: TradingEngineArmState
  reason: string
}

type TradingSummary = {
  tradingMode: string
  emergencyKillSwitch: boolean
  todayPnlQuote: number
  totalPnlQuote: number
  openPositions: number
  winRate: number | null
  engines: Array<TradingEngineStatus>
}

function pnlTone(value: number): 'good' | 'warn' | 'neutral' {
  if (value > 0) return 'good'
  if (value < 0) return 'warn'
  return 'neutral'
}

const CHIP_STYLE: Record<TradingEngineArmState, string> = {
  live: 'border-[color-mix(in_srgb,var(--theme-danger)_40%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_15%,transparent)] text-[var(--theme-danger)]',
  paper: 'border-[color-mix(in_srgb,var(--theme-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-warning)_10%,transparent)] text-[var(--theme-warning)]',
  gated: 'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_8%,transparent)] text-[var(--theme-muted)]',
  disabled:
    'border-[var(--theme-border)] bg-[color-mix(in_srgb,var(--theme-text)_4%,transparent)] text-[var(--theme-muted)]/60',
}

export function TradingSummaryStrip() {
  const [summary, setSummary] = useState<TradingSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/trading/summary', { cache: 'no-store' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as {
          ok: boolean
          summary?: TradingSummary
          error?: string
        }
        if (!data.ok || !data.summary)
          throw new Error(data.error || 'Trading summary unavailable')
        if (!cancelled) {
          setSummary(data.summary)
          setError(null)
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(
            nextError instanceof Error
              ? nextError.message
              : 'Trading summary unavailable',
          )
        }
      }
    }
    void load()
    const interval = setInterval(() => void load(), 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  if (error) {
    return (
      <section className="mt-6 rounded-3xl border border-[color-mix(in_srgb,var(--theme-danger)_25%,transparent)] bg-[color-mix(in_srgb,var(--theme-danger)_10%,transparent)] p-4 text-sm text-[var(--theme-danger)]">
        Trading summary unavailable: {error}
      </section>
    )
  }
  if (!summary) {
    return (
      <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-4 text-sm text-[var(--theme-muted)]">
        Loading trading summary…
      </section>
    )
  }

  return (
    <section className="mt-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Today's P&L"
          value={formatUsdt(summary.todayPnlQuote)}
          tone={pnlTone(summary.todayPnlQuote)}
        />
        <StatCard
          label="Total P&L"
          value={formatUsdt(summary.totalPnlQuote)}
          tone={pnlTone(summary.totalPnlQuote)}
        />
        <StatCard
          label="Open positions"
          value={String(summary.openPositions)}
        />
        <StatCard
          label="Win rate"
          value={
            summary.winRate === null
              ? '—'
              : `${(summary.winRate * 100).toFixed(1)}%`
          }
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {summary.engines.map((engine) => (
          <span
            key={engine.id}
            title={engine.reason}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${CHIP_STYLE[engine.armState]}`}
          >
            {engine.label}: {engine.armState}
          </span>
        ))}
      </div>
    </section>
  )
}
