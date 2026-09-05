import { useCallback, useEffect, useState } from 'react'
import { MiniStat } from './components/mini-stat'
import { formatSignedAmount } from './format-helpers'

interface GridLevelState {
  held: boolean
}
interface GridSymbolState {
  symbol: string
  armed: boolean
  halted: boolean
  pausedForChop: boolean
  lower: number
  upper: number
  levels: Array<GridLevelState>
}
interface GridPaperTrade {
  id: string
  symbol: string
  pnlQuote: number
  feesQuote: number
  closedAt: string
}
interface GridPerformance {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  totalPnlQuote: number
  totalFeesQuote: number
}
interface GridEngineConfig {
  symbols: Array<string>
  quotePerGrid: number
  gridCount: number
}
interface GridState {
  ok: boolean
  config: GridEngineConfig
  states: Array<GridSymbolState>
  trades: Array<GridPaperTrade>
  performance: GridPerformance
}

const money = formatSignedAmount

function symbolStatus(s: GridSymbolState): {
  label: string
  tone: 'good' | 'bad' | 'neutral'
} {
  if (s.halted) return { label: 'Halted', tone: 'bad' }
  if (s.pausedForChop) return { label: 'Paused (choppy)', tone: 'neutral' }
  if (s.armed) return { label: 'Armed', tone: 'good' }
  return { label: 'Arming…', tone: 'neutral' }
}

export function GridTradingPanel() {
  const [state, setState] = useState<GridState | null>(null)
  const [running, setRunning] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/demo-trading-grid', { cache: 'no-store' })
      if (res.ok) setState((await res.json()) as GridState)
    } catch {
      /* transient */
    }
  }, [])

  useEffect(() => {
    void load()
    // Small fixed offset before the recurring timer starts so this panel's
    // poll doesn't land in the same instant as the other trading panels'
    // (grid/llm/rebalance/council each poll a different endpoint every 30s;
    // staggering spreads the resulting requests instead of bursting them).
    let id: number | undefined
    const offset = window.setTimeout(() => {
      id = window.setInterval(load, 30_000)
    }, 3_000)
    return () => {
      window.clearTimeout(offset)
      if (id !== undefined) window.clearInterval(id)
    }
  }, [load])

  const runCycle = useCallback(async () => {
    setRunning(true)
    setNote(null)
    try {
      const res = await fetch('/api/demo-trading-grid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'run_cycle' }),
      })
      const data = await res.json()
      if (!data.ok) setNote(data.error || 'Cycle failed')
      else if (!data.result?.ran)
        setNote(`Idle: ${data.result?.reason ?? 'busy'}`)
      else {
        const count = data.result.trades?.length ?? 0
        setNote(count ? `${count} grid fill(s) this cycle` : 'Ran — no fills')
      }
      await load()
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setRunning(false)
    }
  }, [load])

  const perf = state?.performance
  const recentTrades = state?.trades ?? []

  return (
    <section className="mt-6 rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-panel)]/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--theme-text)]">
            Grid trading engine
          </h2>
          <p className="text-xs text-[var(--theme-muted)]">
            Independent range-bound grid strategy — buys and sells fixed price
            steps automatically. Paper money only, separate from the Binance
            trading engine above.
          </p>
        </div>
        <button
          type="button"
          onClick={runCycle}
          disabled={running}
          className="rounded-xl border border-[color-mix(in_srgb,var(--theme-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--theme-success)_15%,transparent)] px-4 py-2 text-sm font-medium text-[var(--theme-success)] hover:bg-[color-mix(in_srgb,var(--theme-success)_25%,transparent)] disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run one cycle'}
        </button>
      </div>
      {note && <p className="mt-2 text-xs text-[var(--theme-muted)]">{note}</p>}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MiniStat
          label="Closed trades"
          value={perf ? String(perf.totalTrades) : '—'}
        />
        <MiniStat
          label="Win rate"
          value={
            perf && perf.totalTrades > 0
              ? `${(perf.winRate * 100).toFixed(0)}%`
              : '—'
          }
        />
        <MiniStat
          label="Net P/L"
          value={perf ? `${money(perf.totalPnlQuote)} USDT` : '—'}
          tone={perf ? (perf.totalPnlQuote >= 0 ? 'good' : 'bad') : 'neutral'}
        />
        <MiniStat
          label="Fees paid"
          value={perf ? `${perf.totalFeesQuote.toFixed(2)} USDT` : '—'}
        />
      </div>

      <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">
        Per-symbol status
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[var(--theme-muted)]">
              <th className="pb-1 pr-4 font-medium">Symbol</th>
              <th className="pb-1 pr-4 font-medium">Status</th>
              <th className="pb-1 pr-4 font-medium">Range</th>
              <th className="pb-1 font-medium">Levels held</th>
            </tr>
          </thead>
          <tbody>
            {(state?.states ?? []).map((s) => {
              const status = symbolStatus(s)
              const held = s.levels.filter((l) => l.held).length
              const tone =
                status.tone === 'good'
                  ? 'text-[var(--theme-success)]'
                  : status.tone === 'bad'
                    ? 'text-[var(--theme-danger)]'
                    : 'text-[var(--theme-muted)]'
              return (
                <tr
                  key={s.symbol}
                  className="border-t border-[var(--theme-border)]/40"
                >
                  <td className="py-1.5 pr-4 font-medium text-[var(--theme-text)]">
                    {s.symbol}
                  </td>
                  <td className={`py-1.5 pr-4 ${tone}`}>{status.label}</td>
                  <td className="py-1.5 pr-4 tabular-nums text-[var(--theme-muted)]">
                    {s.lower.toFixed(2)} – {s.upper.toFixed(2)}
                  </td>
                  <td className="py-1.5 tabular-nums text-[var(--theme-text)]">
                    {held} / {s.levels.length}
                  </td>
                </tr>
              )
            })}
            {!state?.states.length && (
              <tr>
                <td colSpan={4} className="py-2 text-[var(--theme-muted)]">
                  No grid state yet — waiting for the first cycle to arm.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h3 className="mt-4 text-sm font-semibold text-[var(--theme-text)]">
        Recent fills
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[var(--theme-muted)]">
              <th className="pb-1 pr-4 font-medium">Symbol</th>
              <th className="pb-1 pr-4 font-medium">P/L</th>
              <th className="pb-1 font-medium">Closed</th>
            </tr>
          </thead>
          <tbody>
            {recentTrades.slice(0, 10).map((t) => (
              <tr
                key={t.id}
                className="border-t border-[var(--theme-border)]/40"
              >
                <td className="py-1.5 pr-4 text-[var(--theme-text)]">
                  {t.symbol}
                </td>
                <td
                  className={`py-1.5 pr-4 tabular-nums ${
                    t.pnlQuote >= 0 ? 'text-[var(--theme-success)]' : 'text-[var(--theme-danger)]'
                  }`}
                >
                  {money(t.pnlQuote)} USDT
                </td>
                <td className="py-1.5 text-[var(--theme-muted)]">
                  {new Date(t.closedAt).toLocaleString()}
                </td>
              </tr>
            ))}
            {!recentTrades.length && (
              <tr>
                <td colSpan={3} className="py-2 text-[var(--theme-muted)]">
                  No fills yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}
