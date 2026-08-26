import { useEffect, useState } from 'react'
import { StatCard } from '../../finance/components/stat-card'

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

function formatUsdt(value: number): string {
  return `${value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)} USDT`
}

function pnlTone(value: number): 'good' | 'warn' | 'neutral' {
  if (value > 0) return 'good'
  if (value < 0) return 'warn'
  return 'neutral'
}

const CHIP_STYLE: Record<TradingEngineArmState, string> = {
  live: 'border-red-400/40 bg-red-500/15 text-red-100',
  paper: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
  gated: 'border-[var(--theme-border)] bg-black/10 text-[var(--theme-muted)]',
  disabled: 'border-[var(--theme-border)] bg-black/5 text-[var(--theme-muted)]/60',
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
        const data = (await res.json()) as { ok: boolean; summary?: TradingSummary; error?: string }
        if (!data.ok || !data.summary) throw new Error(data.error || 'Trading summary unavailable')
        if (!cancelled) {
          setSummary(data.summary)
          setError(null)
        }
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Trading summary unavailable')
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
      <section className="mt-6 rounded-3xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-200">
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
        <StatCard label="Today's P&L" value={formatUsdt(summary.todayPnlQuote)} tone={pnlTone(summary.todayPnlQuote)} />
        <StatCard label="Total P&L" value={formatUsdt(summary.totalPnlQuote)} tone={pnlTone(summary.totalPnlQuote)} />
        <StatCard label="Open positions" value={String(summary.openPositions)} />
        <StatCard
          label="Win rate"
          value={summary.winRate === null ? '—' : `${(summary.winRate * 100).toFixed(1)}%`}
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
